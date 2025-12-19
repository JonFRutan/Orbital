import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import LZString from 'lz-string'
import './App.css';


// Helper to parse "DIGIT-CHAR" format
// returns array of { char, octave, id }
const parseMelodyText = (text) => {
    const tokens = [];
    let pendingOctave = null;
    
    // We treat 5 as the "standard" center octave
    const BASELINE_OCTAVE = 5;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        //if it's a digit, it's a modifier for the NEXT inputted character
        if (/[0-9]/.test(char)) {
            pendingOctave = parseInt(char);
            //if this is the last character, we must render it as a pending digit
            if (i === text.length - 1) {
                tokens.push({ type: 'pending', char: char });
            }
            continue;
        }

        //if newline (from tab or enter, desktop and mobile respectively)
        if (char === '\n') {
            tokens.push({ type: 'newline' });
            pendingOctave = null;
            continue;
        }

        //normal character
        tokens.push({ 
            type: 'note', 
            char: char, 
            octave: pendingOctave !== null ? pendingOctave : BASELINE_OCTAVE 
        });
        
        //reset modifier after applied character
        pendingOctave = null;
    }
    return tokens;
};



// audio engine
// C Minor Pentatonic Scale
// a populard choice for simple scales since every not sounds good with one another.
// pulled from:
// https://www.scribd.com/document/454128047/Frequencies-of-Musical-Notes-pdf#:~:text=G3%20196.00%20176.,B4%20493.88%2069.9
const SCALE = [
  130.81, 155.56, 174.61, 196.00, 233.08, 261.63, 311.13, 349.23, 392.00, 466.16,
  523.25, 622.25, 698.46, 783.99, 932.33, 1046.50
];

//handles all the audio, using the browsers gain nodes and oscillator nodes
const AudioEngine = () => {
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);
  const activeNodesRef = useRef(new Map()) //map of currently active words, playing their tunes

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;

      const master = ctx.createGain();
      master.gain.value = .6;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -24; 
      limiter.knee.value = 30;       
      limiter.ratio.value = 12;     
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;

      master.connect(limiter);
      limiter.connect(ctx.destination);
      
      masterGainRef.current = master;

    } else if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const fadeOut = useCallback((duration = 1.5) => {
    if (audioCtxRef.current && masterGainRef.current) {
        const t = audioCtxRef.current.currentTime;
        masterGainRef.current.gain.cancelScheduledValues(t);
        masterGainRef.current.gain.setValueAtTime(masterGainRef.current.gain.value, t);
        masterGainRef.current.gain.linearRampToValueAtTime(0, t + duration);
    }
  }, []);

  const resetVolume = useCallback(() => {
    if (audioCtxRef.current && masterGainRef.current) {
        const t = audioCtxRef.current.currentTime;
        masterGainRef.current.gain.cancelScheduledValues(t);
        //start from 0 and ramp up quickly to avoid a sudden jump in volume
        masterGainRef.current.gain.setValueAtTime(0, t); 
        masterGainRef.current.gain.linearRampToValueAtTime(1, t+0.05); //slightly ramped for pop avoiding
    }
  }, []);

  const stopAll = useCallback(() => {
    if (audioCtxRef.current) {
        audioCtxRef.current.close().then(() => {
            audioCtxRef.current = null;
            masterGainRef.current = null;
        });
    }
  }, []);

  const playTone = useCallback((char, timeOffset = 0, wordId=null, duration = 0.15, volume = 0.1, octaveOverride = null) => {
    //make periods silent for pauses
    if (char === '.') return;
    if (!audioCtxRef.current) initAudio();
    if (!audioCtxRef.current || !masterGainRef.current) return;

    // If many notes are playing, slightly reduce the volume of new notes
    const currentActive = activeNodesRef.current.size;
    const mixingScale = Math.max(0.4, 1 - (currentActive * 0.05)); 
    const finalVol = volume * mixingScale;

    const ctx = audioCtxRef.current;
    const t = ctx.currentTime + timeOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // determine character type
    const isSpecial = !/^[a-zA-Z0-9]$/.test(char);
    // waveform selection
    if (isSpecial) {
        osc.type = 'triangle'; //special
        volume *= 0.4;
    } else {
        osc.type = 'sine';     //alphanumeric
    }
    
    const lowerChar = char.toLowerCase();
    const code = lowerChar.charCodeAt(0);
    
    let alphaIndex;

    if (code >= 97 && code <= 122) {
        // a-z
        alphaIndex = code - 97; 
    } else if (code >= 48 && code <= 57) {
        // 0-9
        alphaIndex = code; 
    } else {
        // specials
        alphaIndex = code;
    }
    
    const safeIndex = Math.max(0, alphaIndex);
    const noteIndex = safeIndex % SCALE.length;
    
    let freq = SCALE[noteIndex];

    //scale wrap shift, so Z is higher than A
    const scaleWrapShift = Math.floor(safeIndex / SCALE.length);
    if (scaleWrapShift > 0) freq *= Math.pow(2, scaleWrapShift % 4);

    if (char !== lowerChar) {
        freq *= 2;
    }

    //octave override if we preface our input with a number
    if (octaveOverride !== null) {
        const baseline = 5;
        const shift = octaveOverride - baseline;
        freq *= Math.pow(2, shift);
    }

    osc.frequency.setValueAtTime(freq, t);

    const noteVolume = volume * 0.8; 

    gain.gain.setValueAtTime(0, t); 
    gain.gain.linearRampToValueAtTime(finalVol, t + 0.02);    
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(masterGainRef.current);
    
    osc.start(t);
    osc.stop(t + duration + 0.1);

    if (wordId) {
        if (!activeNodesRef.current.has(wordId)) {
            activeNodesRef.current.set(wordId, []);
        }
        const nodeGroup = { osc, gain };
        activeNodesRef.current.get(wordId).push(nodeGroup);

        setTimeout(() => {
            const list = activeNodesRef.current.get(wordId);
            if (list) {
                activeNodesRef.current.set(wordId, list.filter(n => n !== nodeGroup));
            }
        }, (timeOffset + duration) * 1000 + 200);
    }
  }, [initAudio]);

  const stopWord = useCallback((wordId, fadeDuration) => {
    const nodes = activeNodesRef.current.get(wordId);
    if (nodes) {
        const t = audioCtxRef.current.currentTime;
        nodes.forEach(({osc, gain}) => {
            const stopDelay = fadeDuration * 1000 + 200; 
            
            try {
                gain.gain.cancelScheduledValues(t);                   
                gain.gain.setValueAtTime(gain.gain.value, t);         
                
                gain.gain.linearRampToValueAtTime(0, t + 0.2); 
            } catch (e) { console.warn(e) }
            
            setTimeout(() => {
                try {
                    osc.stop();
                    osc.disconnect();
                    gain.disconnect(); 
                } catch(e) {}
            }, stopDelay);
        });
        activeNodesRef.current.delete(wordId);
    }
    }, []);

  const playSequence = useCallback((word, wordId=null, volume = 0.1) => {
    if (!audioCtxRef.current) initAudio();
    if (!audioCtxRef.current) return;
    
    const tokens = parseMelodyText(word); //using parser to find octave shifts
    const noteSpacing = 0.15; 
    let timeIndex = 0;

    tokens.forEach((token) => {
        if (token.type === 'note') {
            playTone(token.char, timeIndex * noteSpacing, wordId, 0.4, volume, token.octave);
            timeIndex++;
        }
        else if (token.type === 'newline') {
            // Reset timing to 0 so the next line plays simultaneously with the first
            timeIndex = 0;
        }
    });
  }, [playTone, initAudio]);

  const playPop = useCallback(() => {
    if (!audioCtxRef.current) initAudio();
    if (!audioCtxRef.current || !masterGainRef.current) return;
    const ctx = audioCtxRef.current;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle'; 
    osc.frequency.setValueAtTime(2093, t); 
    osc.frequency.exponentialRampToValueAtTime(1000, t + 0.05);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    
    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.1);
  }, [initAudio]);

  return { initAudio, playTone, playSequence, playPop, stopWord, stopAll, fadeOut, resetVolume };
};

//star generator
const generateStars = (count) => {
    let shadow = "";
    for (let i = 0; i < count; i++) {
        const x = Math.random() * 100; 
        const y = Math.random() * 100; 
        const color = Math.random() > 0.8 ? "#ffffff" : "#aaaaaa"; 
        shadow += `${x}vw ${y}vh 0 ${color},`;
    }
    return shadow.slice(0, -1);
};

//hex palette color generator
const hexToRgb = (hex) => {
  let c;
  if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
      c = hex.substring(1).split('');
      if(c.length === 3){
          c = [c[0], c[0], c[1], c[1], c[2], c[2]];
      }
      c = '0x'+c.join('');
      return [(c>>16)&255, (c>>8)&255, c&255];
  }
  return [100, 100, 100]; // fallback
}

// planet menu (top left)
const ThemeMenu = ({ words, hex, setHex, generatedCode, setWords }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [importCode, setImportCode] = useState('');
    const [copyFeedback, setCopyFeedback] = useState(false);
    const [shareFeedback, setShareFeedback] = useState(false);

    //handles shared urls by autoloading codes that come along with the URL
    useEffect(() => {
        const hash = window.location.hash.substring(1); //substring(1) refers to the pieces of the URL AFTER the domain (orbit.jfelix.space/(1))
        if (hash) {
            try {
                const decompressed = LZString.decompressFromEncodedURIComponent(hash);
                if (decompressed) {
                    const textArray = decompressed.split('|');
                    const sharedWords = textArray.map((text, i) => ({
                        text: text,
                        id: Date.now() + i,
                        orbitDuration: Math.random() * 30 + 30, 
                        startingAngle: Math.random() * 360,
                        forceTrigger: 0 
                    }));
                    setWords(sharedWords);
                }
            } catch (e) {
                console.error("Failed to load shared universe", e);
            }
        }
    }, [setWords]);

    const loadWorld = () => {
        try {
            const decoded = LZString.decompressFromEncodedURIComponent(importCode)
            if(decoded) {
                const textArray =  decoded.split('|');
                const newWords = textArray.map((text, i) => ({
                    text: text,
                    id: Date.now() + i,
                    orbitDuration: Math.random() * 30 + 30, 
                    startingAngle: Math.random() * 360,
                    forceTrigger: 0 
                }));
                setWords(newWords);
                setImportCode('');
            }
        } catch (e) {
            alert("Invalid World Code");
        }
    };

    //creates a shareable URL link using the domain and a generated LZ-String code
    const handleShare = () => {
        const shareUrl = `${window.location.origin}${window.location.pathname}#${generatedCode}`;
        navigator.clipboard.writeText(shareUrl);
        setShareFeedback(true);
        setTimeout(() => setShareFeedback(false), 1000);
    };

    //puts the text from the copy box into the users clipboard
    const handleCopy = () => {
        navigator.clipboard.writeText(generatedCode);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 1000);
    };

    //pulls from users clipboard and pastes into the importcode box
    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setImportCode(text);
        } catch (err) {
            console.error('Failed to read clipboard', err);
        }
    };

    //changes the color palette of the universe to be calculated from the input hex code (which is converted to RGB)
    const applyTheme = (inputHex) => {
        if (!/^#[0-9A-F]{6}$/i.test(inputHex)) return;
        
        const [r, g, b] = hexToRgb(inputHex);
        const root = document.documentElement;

        root.style.setProperty('--bg-base', `rgba(${Math.max(r-200, 5)}, ${Math.max(g-200, 5)}, ${Math.max(b-200, 10)}, 1)`);
        root.style.setProperty('--bg-grad-1', `rgba(${r}, ${g}, ${b}, 0.1)`);
        root.style.setProperty('--bg-grad-2', `rgba(${Math.max(r-50, 0)}, ${Math.max(g-50, 0)}, ${Math.max(b-50, 0)}, 0.2)`);

        root.style.setProperty('--orbit-mask-inner', `rgba(${r}, ${g}, ${b}, 0.15)`);
        root.style.setProperty('--orbit-mask-mid', `rgba(${Math.max(r-100,0)}, ${Math.max(g-100,0)}, ${Math.max(b-100,0)}, 0.4)`);

        root.style.setProperty('--text-primary', inputHex);
        root.style.setProperty('--text-glow', `rgba(${r}, ${g}, ${b}, 0.6)`);
        root.style.setProperty('--text-highlight', '#ffffff'); 
        root.style.setProperty('--particle-color', inputHex);
    };

    const handleHexChange = (e) => {
        setHex(e.target.value);
        applyTheme(e.target.value);
    };

    return (
        <div className="theme-menu-container">
            <button 
                className="theme-planet-btn" 
                onClick={() => setIsOpen(!isOpen)}
                title="Settings"
            >
            </button>
            {isOpen && (
                <div className="theme-popout-content">
                    {/* color theme popout */}
                    <div className="theme-section">
                        <label>Universe Palette</label>
                        <input 
                            type="text" 
                            value={hex}
                            onChange={handleHexChange}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="#RRGGBB"
                            maxLength={7}
                            className="theme-hex-input"
                        />
                    </div>

                    <div className="theme-divider"></div>

                    <div className="theme-section">
                        <label>Share System</label>
                        <div className="input-row">
                            <button 
                                className={`action-btn ${shareFeedback ? 'success' : ''}`} 
                                onClick={handleShare}
                                disabled={!generatedCode}
                            >
                                {shareFeedback ? 'LINK COPIED!' : 'GET SHARE LINK'}
                            </button>
                        </div>
                    </div>

                    <div className="theme-divider"></div>

                    {/* export base64 section */}
                    <div className="theme-section">
                        <label>Export System</label>
                        <div className="input-row">
                            <input 
                                type="text"
                                readOnly
                                value={generatedCode || "Empty"}
                                className="code-input-readonly"
                            />
                            <button 
                                className={`icon-btn ${copyFeedback ? 'success' : ''}`} 
                                onClick={handleCopy} 
                                title="Copy Code"
                            >
                                {copyFeedback ? '✓' : 'C'}
                            </button>
                        </div>
                    </div>

                    {/* import base64 section */}
                    <div className="theme-section">
                        <label>Import System</label>
                        <div className="input-row">
                            <input 
                                type="text"
                                value={importCode}
                                onChange={(e) => setImportCode(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                placeholder="Code..."
                                className="code-input"
                            />
                            <button className="icon-btn" onClick={handlePaste} title="Paste Code">P</button>
                            <button className="action-btn" onClick={loadWorld} title="Load World">GO</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// info panel (bottom left)
const InfoPanel = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="info-panel-container">
            {isOpen && (
                <div className="info-box">
                    <h3>orbit.jfelix.space</h3>
                    <p>
                        Make pleasant, ambient sound systems by entering strings of characters. Please enjoy!<br></br>
                        <p>Right click to delete, left click to play. Hit tab for multi-line melodies, periods (.) for pauses.</p>
                        <a href="https://portfolio.jfelix.space">jfelix.space</a> || <a href="https://www.linkedin.com/in/jonathanrutan/">LinkedIn</a>
                    </p>
                </div>
            )}
            <button 
                className={`info-toggle-btn ${isOpen ? 'active' : ''}`} 
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? '✕' : '?'}
            </button>
        </div>
    );
};

// double-tap detector, used on mobile to replace right-clicking
const useDoubleTap = (callback, singleTapCallback = () => {}) => {
    const lastTap = useRef(0);
    
    return useCallback((e) => {
        const now = Date.now();
        const DOUBLE_PRESS_DELAY = 300;
        
        if (now - lastTap.current < DOUBLE_PRESS_DELAY) {
            callback(e);
            lastTap.current = 0; // reset
        } else {
            lastTap.current = now;
            singleTapCallback(e);
        }
    }, [callback, singleTapCallback]);
};

const FloatingWord = ({ wordData, assignedRadius, removeWord, playSequence, disableRandom }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSuperBright, setIsSuperBright] = useState(false);
  const isPlayingRef = useRef(false); 
  const elementRef = useRef(null);

  const triggerPerformance = useCallback((volume, superBright = false) => {
      if (isPlayingRef.current) return; 
      isPlayingRef.current = true;
      setIsPlaying(true);
      if(superBright) setIsSuperBright(true);
      playSequence(wordData.text, wordData.id, volume);
      const lines = wordData.text.split('\n');
      const longestLineLength = Math.max(...lines.map(l => l.length));
      const approxDurationMS = (longestLineLength * 150) + 500;
      setTimeout(() => {
          setIsPlaying(false);
          setIsSuperBright(false);
          isPlayingRef.current = false;
      }, approxDurationMS);
  }, [wordData.text, playSequence]);

  useEffect(() => {
    if (wordData.forceTrigger) {
        isPlayingRef.current = false;
        triggerPerformance(0.25, true);
    }
  }, [wordData.forceTrigger, triggerPerformance]);

  useEffect(() => {
    const loopInterval = Math.random() * 7000 + 5000; 
    const intervalId = setInterval(() => {
       if (!disableRandom) triggerPerformance(0.02, false);
    }, loopInterval);
    return () => clearInterval(intervalId);
  }, [triggerPerformance, disableRandom]);

  // double tap logic
  const handleTap = useDoubleTap(
      (e) => {
        // double tapping -> delete a word
        const rect = elementRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        removeWord(wordData.id, centerX, centerY, e);
      },
      () => {
        // single tapping -> play the word
        triggerPerformance(0.2);
      }
  );

  const handleRightClick = (e) => {
    const rect = elementRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    removeWord(wordData.id, centerX, centerY, e);
  };

  //render the content before the shell, this uses parseing so we can visually modify octave shifted notes
  const renderContent = () => {
      const tokens = parseMelodyText(wordData.text);
      
      return tokens.map((token, i) => {
          if (token.type === 'newline') return <br key={i} />;
          if (token.type === 'pending') return null; //don't show trailing digits in floating words
          if (token.char === ' ') {
              return <span key={i} className="char-note">{'\u00A0'}</span>;
          }
          let className = 'char-note';
          if (token.octave < 4) className += ' octave-lowest';
          else if (token.octave < 5) className += ' octave-low';
          else if (token.octave > 6) className += ' octave-high';
          
          return (
              <span key={i} className={className}>
                  {token.char}
              </span>
          );
      });
  };

  const renderShell = (isTrail = false, trailIndex = 0) => {
    const trailLagDegrees = isTrail ? trailIndex * 2.5 : 0; 
    const visualStyle = isTrail 
        ? { opacity: 0.4 - (trailIndex * 0.08), zIndex: 10 - trailIndex }
        : { zIndex: 20 };

    let activeClass = '';
    if (isPlaying) {
        activeClass = 'trail-active';
        if (isSuperBright) activeClass += ' super-bright';
    }

    return (
        <div 
            className={`orbit-wrapper ${isTrail ? 'is-trail' : ''} ${activeClass}`}
            style={{
                '--orbit-duration': `${wordData.orbitDuration}s`, 
                '--start-angle': `${wordData.startingAngle - trailLagDegrees}deg`,
                ...visualStyle
            }}
        >
            <div className="orbit-distance" style={{ '--orbit-radius': assignedRadius }}>
                <div 
                    ref={isTrail ? null : elementRef}
                    className="orbit-counter-rotator"
                    onClick={!isTrail ? handleTap : undefined} // handles 'taps' for mobile devices
                    onContextMenu={!isTrail ? handleRightClick : undefined}
                >
                    <span className={`word-text ${isPlaying && !isTrail ? 'is-comet' : ''} ${isSuperBright ? 'super-text' : ''}`}>
                        {renderContent()}
                    </span>
                </div>
            </div>
        </div>
    );
  };

  return (
    <>
        {renderShell(true, 4)}
        {renderShell(true, 3)}
        {renderShell(true, 2)}
        {renderShell(true, 1)}
        {renderShell(false)}
    </>
  );
};

// intro text
const IntroOverlay = () => {
    const [text, setText] = useState("Type some words...");
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        const fadeOut1 = setTimeout(() => {
            setVisible(false);
        }, 3000);

        const changeText = setTimeout(() => {
            setText("then hit enter...");
            setVisible(true);
        }, 5000);

        const fadeOut2 = setTimeout(() => {
            setVisible(false);
        }, 9000);

        return () => {
            clearTimeout(fadeOut1);
            clearTimeout(changeText);
            clearTimeout(fadeOut2);
        };
    }, []);
    
    return (
        <div className={`intro-overlay ${visible ? 'visible' : 'hidden'}`}>
            <div className="wavy-text" key={text}>
                {text.split('').map((char, i) => (
                    <span key={i} style={{'--i': i}}>
                        {char === ' ' ? '\u00A0' : char}
                    </span>
                ))}
            </div>
        </div>
    );
};

// 'voyager' is a cute term for public systems that you can click on to load.
const Voyager = ({ onSelectSystem, currentCode, currentHex }) => {
    const [systems, setSystems] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [form, setForm] = useState({ name: '', composer: '', description: '' });

    const fetchSystems = () => {
        fetch('/api/systems')
            .then(res => res.json())
            .then(data => setSystems(data.reverse()))
            .catch(err => console.error("Database offline", err));
    };

    useEffect(() => {
        if (isOpen) fetchSystems();
    }, [isOpen]);

    const handlePublish = async () => {
        if (!form.name || !form.composer) {
            alert("Please provide a system name and composer name.");
            return;
        }

        try {
            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name,
                    composer: form.composer,
                    desc: form.description,
                    code: currentCode,
                    hex: currentHex
                })
            });

            if (response.ok) {
                setForm({ name: '', composer: '', description: '' });
                setIsPublishing(false);
                fetchSystems();
                alert("System Added to the star map.");
            }
        } catch (e) {
            alert("Connection to Star Map failed.");
        }
    };

    //render a small planet icon, using the voyager items system palette
    const PlanetIcon = ({ color }) => (
        <svg width="32" height="32" viewBox="0 0 32 32" className="planet-icon-small" style={{ '--glow-color': color }}>
            <defs>
                <radialGradient id={`grad-${color.replace('#','')}`} cx="30%" cy="30%" r="70%">
                    <stop offset="0%" style={{ stopColor: '#ffffff', stopOpacity: 0.8 }} />
                    <stop offset="100%" style={{ stopColor: color, stopOpacity: 1 }} />
                </radialGradient>
            </defs>
            <circle cx="16" cy="16" r="12" fill={`url(#grad-${color.replace('#','')})`} />
            <circle cx="16" cy="16" r="12" fill="transparent" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
        </svg>
    );

    return (
        <div className="voyager-container">
            <button 
                className={`voyager-toggle-btn ${isOpen ? 'active' : ''}`} 
                onClick={() => setIsOpen(!isOpen)}
                title="Star Map Portfolio"
            />
            {isOpen && (
                <div className="voyager-list">
                    <h3 style={{ fontFamily: 'Montserrat, sans-serif', textShadow: '0 0 20px var(--text-glow)', fontSize: '2em', textAlign: 'center', margin: '0 0 15px 0', letterSpacing: '4px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '10px' }}>VOYAGER</h3>
                    
                    <div className="publish-section">
                        {!isPublishing ? (
                            <button 
                                className="action-btn" 
                                style={{ width: '100%' }}
                                onClick={() => setIsPublishing(true)}
                                disabled={!currentCode}
                            >
                                PUBLISH CURRENT SYSTEM
                            </button>
                        ) : (
                            <div className="publish-fields">
                                <input 
                                    className="theme-hex-input" 
                                    placeholder="System Name"
                                    value={form.name}
                                    onChange={e => setForm({...form, name: e.target.value})}
                                />
                                <input 
                                    className="theme-hex-input" 
                                    placeholder="System Description"
                                    value={form.description}
                                    onChange={e => setForm({...form, description: e.target.value})}
                                />
                                <input 
                                    className="theme-hex-input" 
                                    placeholder="Composer Name"
                                    value={form.composer}
                                    onChange={e => setForm({...form, composer: e.target.value})}
                                />
                                <div className="input-row">
                                    <button className="action-btn" onClick={handlePublish}>CONFIRM</button>
                                    <button className="icon-btn" onClick={() => setIsPublishing(false)}>✕</button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="voyager-items-scroll">
                        {systems.length === 0 && <p style={{opacity: 0.5, fontSize: '0.8rem'}}>Searching the stars...</p>}
                        {systems.map(s => (
                            <div key={s.id} className="voyager-item" onClick={() => {
                                onSelectSystem(s);
                                setIsOpen(false); // Close menu on select
                            }}>
                                <PlanetIcon color={s.hex || '#8daabf'} />
                                <div className="item-content">
                                    <div className="item-header">
                                        <strong>{s.name}</strong>
                                    </div>
                                    <div className="item-composer">by {s.composer}</div>
                                    {s.description && <div className="item-description">{s.description}</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

//handling mobile input, since 'tab' isn't a button we can use, we use enter instead and rely on a new send button
const MobileInput = ({ onSend, currentInput, setInput, playTone }) => {
    
    const handleChange = (e) => {
        let newVal = e.target.value;
        const lastChar = newVal.slice(-1);
        
        if (newVal.length > currentInput.length) {
            if (!/[0-9]/.test(lastChar)) {
                 const secondLastChar = newVal.slice(-2, -1);
                 let octave = null;
                 if (/[0-9]/.test(secondLastChar)) {
                     octave = parseInt(secondLastChar);
                 }
                 playTone(lastChar, 0, 'typing', 0.15, 0.2, octave);
            }
            if (/[0-9]/.test(lastChar)) {
                const secondLastChar = newVal.slice(-2, -1);
                if (/[0-9]/.test(secondLastChar)) {
                    newVal = newVal.slice(0, -2) + lastChar;
                }
            }
        }
        
        setInput(newVal);
    };

    return (
        <div className="mobile-input-bar">
             <textarea 
                className="mobile-text-input"
                placeholder="Type here..."
                value={currentInput}
                onChange={handleChange} 
                rows={1}
            />
            <button className="mobile-send-btn" onClick={onSend}>
                ➤
            </button>
        </div>
    );
};

// main app
export default function App() {
  const [isMobile, setIsMobile] = useState(false); //is the user on a mobile device?
  const [input, setInput] = useState('');
  const [words, setWords] = useState([]);
  const [particles, setParticles] = useState([]);
  const [isPlanetOrchestra, setIsPlanetOrchestra] = useState(false); 
  const [pan, setPan] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const [hex, setHex] = useState('#8daabf');            //pulled from ThemeMenu
  const [generatedCode, setGeneratedCode] = useState(''); //pulled from above App

  const starBoxShadow = useMemo(() => generateStars(300), []);
  const twinklingBoxShadow = useMemo(() => generateStars(100), []);

  const lastTouchDistance = useRef(null); //for "pinching" to zoom on mobile devices 
  const { initAudio, playTone, playSequence, playPop, stopWord, stopAll, fadeOut, resetVolume } = AudioEngine();
  const inputRef = useRef(null);

  //check for mobile on mount and resize
  useEffect(() => {
      const checkMobile = () => {
          setIsMobile(window.innerWidth <= 768);
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
  }, []);

  //moved into app so it can be used for both the Voyager menu and for the normal exporting/importing
  //maps all the words into a compressed format, now using LZ-String
    useEffect(() => {
      if (words.length === 0) {
          setGeneratedCode('');
          //clear the hash if the universe is empty
          window.history.replaceState(null, '', window.location.pathname);
          return;
      }
      const payload = words.map(w => w.text).join('|');
      
      const code = LZString.compressToEncodedURIComponent(payload);
      setGeneratedCode(code);
      
      //automatically replace the window the new world code
      window.history.replaceState(null, '', `#${code}`);
      
  }, [words]);

  //load a system from the voyager menu
  const loadFromVoyager = (system) => {
    //tell the server that a system has been clicked on to increase it's click meter
    fetch(`/api/click/${system.id}`, { method: 'POST' });
    stopAll()

    //apply the saved theme from the system
    console.log(system.hex);
    setHex(system.hex);
    applyTheme(system.hex);

    //reset zooming/frame
    setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setZoom(1);

    //decompress the words and place them into the system
    const decoded = LZString.decompressFromEncodedURIComponent(system.code);
    if (decoded) {
        const textArray = decoded.split('|');
        const newWords = textArray.map((text, i) => ({
            text: text,
            id: Date.now() + i,
            orbitDuration: Math.random() * 30 + 30, 
            startingAngle: Math.random() * 360,
            forceTrigger: 0 
        }));
        setWords(newWords);
    }
};

    //changes the color palette of the universe to be calculated from the input hex code (which is converted to RGB)
    const applyTheme = (inputHex) => {
        if (!/^#[0-9A-F]{6}$/i.test(inputHex)) return;
        
        const [r, g, b] = hexToRgb(inputHex);
        const root = document.documentElement;

        root.style.setProperty('--bg-base', `rgba(${Math.max(r-200, 5)}, ${Math.max(g-200, 5)}, ${Math.max(b-200, 10)}, 1)`);
        root.style.setProperty('--bg-grad-1', `rgba(${r}, ${g}, ${b}, 0.1)`);
        root.style.setProperty('--bg-grad-2', `rgba(${Math.max(r-50, 0)}, ${Math.max(g-50, 0)}, ${Math.max(b-50, 0)}, 0.2)`);
        root.style.setProperty('--orbit-mask-inner', `rgba(${r}, ${g}, ${b}, 0.15)`);
        root.style.setProperty('--orbit-mask-mid', `rgba(${Math.max(r-100,0)}, ${Math.max(g-100,0)}, ${Math.max(b-100,0)}, 0.4)`);
        root.style.setProperty('--text-primary', inputHex);
        root.style.setProperty('--text-glow', `rgba(${r}, ${g}, ${b}, 0.5)`);
        root.style.setProperty('--text-highlight', '#ffffff'); 
        root.style.setProperty('--particle-color', inputHex);
    };

  const handleKeyDown = (e) => {
    if (isMobile) return; //if it's mobile device, DONT DO ANYTHING
    initAudio();

    if (e.key === 'Tab') {
        e.preventDefault();
        // hit tab for new line
        //find our current line
        const lines = input.split('\n');
        const currentLine = lines[lines.length - 1];
        //index of the first character
        const firstCharIndex = 0;
        // find the leading amount of whitespace needed to match up the characters (keep them aligned)
        // this finds how many spaces are at the start of the line
        const indentSize = firstCharIndex === -1 ? 0 : firstCharIndex;
        const indentation = " ".repeat(indentSize);
        
        // append a newline plus the calculated indentation
        setInput(prev => prev + '\n' + indentation);
        return;
    }

    if (e.key === 'Enter') {
      if (input.trim().length > 0) {
        playSequence(input, 0.2); 
        setWords((prev) => [...prev, {
          text: input,
          id: Date.now(),
          orbitDuration: Math.random() * 30 + 30, 
          startingAngle: Math.random() * 360,
          forceTrigger: 0 
        }]);
        setInput('');
      }
      return;
    }
    if (e.key === 'Backspace') {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // allow any single printable character
    const isPrintable = e.key.length === 1;
    
    if (isPrintable) {
        //we use pipe characters for string delimiting, so ignore those
        if (e.key != '|') { 
            if (/[0-9]/.test(e.key)) {
                setInput((prev) => {
                    //check if the current input already ends with a digit
                    if (prev.length > 0 && /[0-9]/.test(prev.slice(-1))) {
                        //remove the previous digit and replace it with the new one
                        return prev.slice(0, -1) + e.key;
                    }
                    //otherwise just put it back in
                    return prev + e.key;
                });
            } else {
                const lastChar = input.slice(-1);
                 let octave = null;
                 if (/[0-9]/.test(lastChar)) {
                     octave = parseInt(lastChar);
                 }
                 playTone(e.key, 0, 'typing', 0.15, 0.2, octave); 
                 setInput((prev) => prev + e.key);
            }
        }
    }
  };

  //handles the submit button on mobile devices
  const handleMobileSubmit = () => {
      if (input.trim().length > 0) {
          playSequence(input, 0.2); 
          setWords((prev) => [...prev, {
            text: input,
            id: Date.now(),
            orbitDuration: Math.random() * 30 + 30, 
            startingAngle: Math.random() * 360,
            forceTrigger: 0 
          }]);
          setInput('');
      }
  };

  // PLANETARY ORCHESTRA
  // this will play every word in order starting from the innermost word (shortest) to the outermost (longest) with a tiny delay between each one
  const handlePlanetClick = (e) => {
    if (isPlanetOrchestra) return; // so you can't just spam the planet to create a crazy amount of noise
    e.stopPropagation();
    // immediately disable randoms so they don't fire during the fade out
    setIsPlanetOrchestra(true);
    // force stop every currently playing word
    words.forEach((word) => {
        stopWord(word.id, .3)
    })
    fadeOut(1.5); //silence all currently playing noises
    setTimeout(() => {
        resetVolume();
        initAudio(); 

        const sortedWords = [...words].sort((a, b) => {
            if (a.text.length === b.text.length) return a.id - b.id;
            return a.text.length - b.text.length;
        });

        let accumulatedDelay = 0;

        sortedWords.forEach((word) => {
            //calculate how long this word takes to play
            //formula matches FloatingWord: (maxLineLength * 150ms) + 100ms tail
            const lines = word.text.split('\n');
            const longestLineLength = Math.max(...lines.map(l => l.length));
            const duration = (longestLineLength * 150) + 100;
            
            setTimeout(() => {
                setWords(prevWords => prevWords.map(w => {
                    if (w.id === word.id) {
                        return { ...w, forceTrigger: Date.now() }; 
                    }
                    return w;
                }));
            }, accumulatedDelay);

            //increment delay for the next word
            accumulatedDelay += (duration);
        });

        //re-enable random ambient sounds after the entire sequence finishes
        setTimeout(() => {
            setIsPlanetOrchestra(false);
        }, accumulatedDelay + 1000);

    }, 1600); 
  };

  const spawnParticles = useCallback((x, y, type = 'pop') => {
    const isNova = type === 'nova';
    const particleCount = isNova ? 200 : 20; 
    const newParticles = [];
    const timestamp = Date.now();
    
    for (let i = 0; i < particleCount; i++) {
        const angle = Math.random() * 360;
        const distance = Math.random() * (isNova ? 600 : 120) + (isNova ? 50 : 20);
        const size = Math.random() * 4 + 2; 
        const duration = Math.random() * 0.6 + 0.5;

        let colorVar = '#ffffff';
        const chance = Math.random();
        if (chance > 0.6) colorVar = 'var(--particle-color)';
        else if (chance > 0.8) colorVar = '#555555';

        newParticles.push({
            id: timestamp + i, x, y,
            style: { 
                '--angle': `${angle}deg`, 
                '--distance': `${distance}px`,
                '--size': `${size}px`, 
                '--duration': `${duration}s`,
                '--color': colorVar
            }
        });
    }
    setParticles(prev => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles(prev => prev.filter(p => p.id < timestamp));
    }, 1200);
  }, []);

  const handlePlanetRightClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      playPop(); 
      spawnParticles(e.clientX, e.clientY, 'nova');
      //gently stop each word before we kill them
      //this prevents lingering melodies from existing once you right click the planet
      words.forEach((word) => {
        console.log(word.id)
        stopWord(word.id, .1)
      })
      setWords([]); 
  };

  //handles planet tapping on mobile devices
  const handlePlanetTap = useDoubleTap(
    (e) => handlePlanetRightClick(e), //double tap -> delete all
    (e) => handlePlanetClick(e)       //single tap -> orchestra
  );

  const handleMouseDown = (e) => {
    if (e.target === containerRef.current || e.target.classList.contains('safe-zone-mask')) {
        setIsDragging(true);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        containerRef.current.style.cursor = 'grabbing';
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - lastMousePos.current.x;
    const deltaY = e.clientY - lastMousePos.current.y;
    setPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = (e) => {
    setIsDragging(false);
    if (containerRef.current) containerRef.current.style.cursor = 'grab';
    
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        inputRef.current?.focus(); 
    }
  };

  const handleWheel = useCallback((e) => {
    //e.preventDefault(); //this was throwing errors
    const zoomIntensity = 0.001;
    const delta = -e.deltaY * zoomIntensity;
    const newZoom = Math.min(Math.max(zoom + delta, 0.1), 4); 

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const universeXBeforeZoom = (mouseX - pan.x) / zoom;
    const universeYBeforeZoom = (mouseY - pan.y) / zoom;

    setPan({
        x: mouseX - universeXBeforeZoom * newZoom,
        y: mouseY - universeYBeforeZoom * newZoom
    });
    newZoom && setZoom(newZoom);
  }, [zoom, pan]);


  const removeWord = useCallback((id, x, y, e) => {
    //console.log(id, x, y)
    e.preventDefault();
    e.stopPropagation();
    playPop();
    spawnParticles(x, y, 'pop');
    stopWord(id, .1)
    setWords((prev) => prev.filter(w => w.id !== id));
  }, [playPop, spawnParticles]);

  const processedWords = useMemo(() => {
    const sorted = [...words].sort((a, b) => {
        // use length of first line for sorting if multi-line
        const lenA = a.text.split('\n')[0].length;
        const lenB = b.text.split('\n')[0].length;
        if (lenA === lenB) return a.id - b.id;
        return lenA - lenB;
    });

    return sorted.map((word, index) => {
        const radiusVal = 250 + (index * 120);
        return {
            ...word,
            radiusVal: radiusVal, 
            assignedRadius: `${radiusVal}px`
        };
    });
  }, [words]);

  // MOBILE TOUCHING EVENTS
  const handleTouchStart = (e) => {
      // 1 finger, panning
      if (e.touches.length === 1) {
          if (e.target === containerRef.current || e.target.classList.contains('safe-zone-mask')) {
            setIsDragging(true);
            const touch = e.touches[0];
            lastMousePos.current = { x: touch.clientX, y: touch.clientY };
          }
      } 
      // 2 fingers, zooming
      else if (e.touches.length === 2) {
          setIsDragging(false);
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          lastTouchDistance.current = dist;
      }
  };

  const handleTouchMove = (e) => {
      // 1 finger, panning
      if (e.touches.length === 1 && isDragging) {
          const touch = e.touches[0];
          const deltaX = touch.clientX - lastMousePos.current.x;
          const deltaY = touch.clientY - lastMousePos.current.y;
          setPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
          lastMousePos.current = { x: touch.clientX, y: touch.clientY };
      }
      // 2 fingers, zooming
      else if (e.touches.length === 2) {
          const t1 = e.touches[0];
          const t2 = e.touches[1];
          const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
          
          if (lastTouchDistance.current) {
              const delta = dist - lastTouchDistance.current;
              //sensitivity factor for touch zoom
              const zoomFactor = delta * 0.005; 
              setZoom(prev => Math.min(Math.max(prev + zoomFactor, 0.1), 4));
          }
          lastTouchDistance.current = dist;
      }
  };

  const handleTouchEnd = () => {
      setIsDragging(false);
      lastTouchDistance.current = null;
  };

  const maxRadiusVal = useMemo(() => {
    if (processedWords.length === 0) return 300; 
    return processedWords[processedWords.length - 1].radiusVal + 100; 
  }, [processedWords]);


  return (
    <div 
        ref={containerRef}
        className="zoom-container" 
        onWheel={handleWheel}

        //mouse events
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        //mobile events
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
    >
      <div className="stars" style={{ boxShadow: starBoxShadow }}></div>
      <div className="stars-twinkle" style={{ boxShadow: twinklingBoxShadow }}></div>

      <ThemeMenu 
        words={words} 
        hex={hex} 
        setHex={setHex} 
        generatedCode={generatedCode}
        setWords={setWords} 
      />
      <Voyager 
        onSelectSystem={loadFromVoyager} 
        currentCode={generatedCode}
        currentHex={hex}
      />

      {!isMobile && <InfoPanel />}

      <IntroOverlay />

      <div 
        className="universe"
        style={{ 
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
        }}
      >
        <div 
            className="safe-zone-mask"
            style={{ width: maxRadiusVal * 2, height: maxRadiusVal * 2 }}
        ></div>

        <div 
            className="planet" 
            onClick={isMobile ? handlePlanetTap : handlePlanetClick} //if on mobile use planet tap, on desktop use planet click
            onContextMenu={handlePlanetRightClick}
        ></div>
        
        <div className="word-atmosphere">
            {processedWords.map((word) => (
            <FloatingWord 
                key={word.id} 
                wordData={word} 
                assignedRadius={word.assignedRadius}
                removeWord={removeWord} 
                playSequence={playSequence} 
                disableRandom={isPlanetOrchestra}
            />
            ))}
        </div>
      </div>

      <div className="ui-fixed-layer">
        <div className="particle-layer">
            {particles.map(p => (
                <div key={p.id} className="particle" style={{ top: p.y, left: p.x, ...p.style }} />
            ))}
        </div>
        
        {/* Only show the "Floating Text" visualization, not the input bar if on mobile */}
        <div className="input-zone">
            <div className="current-input">
            {/* Use the parser for the input display */}
            {parseMelodyText(input).map((token, i) => {
                if (token.type === 'newline') return <div key={i} style={{flexBasis:'100%', height:0}}></div>;
                
                if (token.type === 'pending') {
                    return <span key={i} className="pending-modifier">{token.char}</span>;
                }
                if (token.char === ' ') {
                    return <span key={i} className="char-note">{'\u00A0'}</span>;
                }
                let className = 'char-note';
                // Apply visual classes based on octave
                if (token.octave < 5) className += ' octave-low';
                if (token.octave > 6) className += ' octave-high';

                return <span key={i} className={className}>{token.char}</span>;
            })}
            <span className="caret">|</span>
            </div>
        </div>
      </div>
      
      {/* if Mobile: Show visible input bar at bottom.
         if Desktop: Use hidden input with autoFocus. */}
      {isMobile ? (
          <MobileInput 
            currentInput={input}
            setInput={setInput}
            onSend={handleMobileSubmit}
            playTone={playTone}
          />
      ) : (
          <input 
            ref={inputRef}
            className="hidden-input"
            type="text" 
            onKeyDown={handleKeyDown} 
            autoFocus
          />
      )}
    </div>
  );
}