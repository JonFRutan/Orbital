import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './App.css';

// --- AUDIO ENGINE ---
const SCALE = [
  130.81, 155.56, 174.61, 196.00, 233.08, 261.63, 311.13, 349.23, 392.00, 466.16,
  523.25, 622.25, 698.46, 783.99, 932.33, 1046.50
];

const AudioEngine = () => {
  const audioCtxRef = useRef(null);
  const masterGainRef = useRef(null);

  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      
      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
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
        masterGainRef.current.gain.setValueAtTime(1, t);
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

  const playTone = useCallback((char, timeOffset = 0, duration = 0.15, type = 'typing', volume = 0.1) => {
    if (!audioCtxRef.current) initAudio();
    if (!audioCtxRef.current || !masterGainRef.current) return;

    const ctx = audioCtxRef.current;
    const t = ctx.currentTime + timeOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    
    // --- PITCH CALCULATION ---
    const lowerChar = char.toLowerCase();
    // Normalize 'a' to 0, 'b' to 1, etc.
    const alphaIndex = lowerChar.charCodeAt(0) - 97; 
    
    // Ensure we handle non-alpha gracefully (though input limits this)
    const safeIndex = Math.max(0, alphaIndex);

    // Get index in the 16-note scale
    const noteIndex = safeIndex % SCALE.length;
    
    // Calculate how many times we've wrapped around the 16-note scale (e.g., 'q' is index 16, wraps once)
    const scaleWrapShift = Math.floor(safeIndex / SCALE.length);
    
    let freq = SCALE[noteIndex];

    // Apply wrap shift (Octave up for letters past 'p')
    if (scaleWrapShift > 0) {
        freq *= Math.pow(2, scaleWrapShift);
    }

    // Apply Uppercase shift (Octave up)
    if (char !== lowerChar) {
        freq *= 2;
    }

    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(masterGainRef.current);
    
    osc.start(t);
    osc.stop(t + duration);
  }, [initAudio]);

  const playSequence = useCallback((word, volume = 0.1) => {
    if (!audioCtxRef.current) initAudio();
    if (!audioCtxRef.current) return;
    const noteSpacing = 0.15; 
    word.split('').forEach((char, index) => {
      playTone(char, index * noteSpacing, 0.4, 'melody', volume);
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
    gain.gain.linearRampToValueAtTime(0.2, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    
    osc.connect(gain);
    gain.connect(masterGainRef.current);
    osc.start(t);
    osc.stop(t + 0.1);
  }, [initAudio]);

  return { initAudio, playTone, playSequence, playPop, stopAll, fadeOut, resetVolume };
};

// --- UTILITY: Generate Starfield CSS ---
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

// --- UTILITY: Color Manipulation ---
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
  return [100, 100, 100]; // Fallback
}

// --- COMPONENT: THEME PLANET MENU ---
const ThemeMenu = ({ words, setWords }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [hex, setHex] = useState('#8daabf');
    const [generatedCode, setGeneratedCode] = useState('');
    const [importCode, setImportCode] = useState('');
    const [copyFeedback, setCopyFeedback] = useState(false);

    useEffect(() => {
        const payload = words.map(w => w.text);
        const code = btoa(JSON.stringify(payload));
        setGeneratedCode(code);
    }, [words]);

    const loadWorld = () => {
        try {
            const decoded = atob(importCode);
            const textArray = JSON.parse(decoded);
            
            if(Array.isArray(textArray)) {
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

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedCode);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 1000);
    };

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            setImportCode(text);
        } catch (err) {
            console.error('Failed to read clipboard', err);
        }
    };

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
                    {/* Color Section */}
                    <div className="theme-section">
                        <label>Atmosphere</label>
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

                    {/* Export Section */}
                    <div className="theme-section">
                        <label>Export World</label>
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
                                {copyFeedback ? '✓' : '📋'}
                            </button>
                        </div>
                    </div>

                    {/* Import Section */}
                    <div className="theme-section">
                        <label>Import World</label>
                        <div className="input-row">
                            <input 
                                type="text"
                                value={importCode}
                                onChange={(e) => setImportCode(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                placeholder="Code..."
                                className="code-input"
                            />
                            <button className="icon-btn" onClick={handlePaste} title="Paste Code">📥</button>
                            <button className="action-btn" onClick={loadWorld} title="Load World">GO</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- COMPONENT: INFO PANEL ---
const InfoPanel = () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="info-panel-container">
            {isOpen && (
                <div className="info-box">
                    <h3>System Info</h3>
                    <p>
                        This is a placeholder for future instructions, credits, or lore about the generated universe. 
                        Currently functioning as a structural element.
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

// --- COMPONENT: FLOATING WORD ---
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

    playSequence(wordData.text, volume);
    
    const approxDurationMS = (wordData.text.length * 150) + 500;
    setTimeout(() => {
        setIsPlaying(false);
        setIsSuperBright(false);
        isPlayingRef.current = false;
    }, approxDurationMS);
  }, [wordData.text, playSequence]);

  useEffect(() => {
    if (wordData.forceTrigger) {
        triggerPerformance(0.25, true);
    }
  }, [wordData.forceTrigger, triggerPerformance]);

  useEffect(() => {
    const loopInterval = Math.random() * 7000 + 5000; 
    const intervalId = setInterval(() => {
       if (!disableRandom) {
           triggerPerformance(0.02, false);
       }
    }, loopInterval);
    return () => clearInterval(intervalId);
  }, [triggerPerformance, disableRandom]);

  const handleRightClick = (e) => {
    const rect = elementRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    removeWord(wordData.id, centerX, centerY, e);
  };

  const renderShell = (isTrail = false, trailIndex = 0) => {
    const trailLagDegrees = isTrail ? trailIndex * 2.5 : 0; 
    const visualStyle = isTrail 
        ? { 
            opacity: 0.4 - (trailIndex * 0.08), 
            zIndex: 10 - trailIndex
          }
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
            <div 
                className="orbit-distance"
                style={{ '--orbit-radius': assignedRadius }}
            >
                <div 
                    ref={isTrail ? null : elementRef}
                    className="orbit-counter-rotator"
                    onClick={!isTrail ? () => triggerPerformance(0.2) : undefined} 
                    onContextMenu={!isTrail ? handleRightClick : undefined}
                >
                    <span className={`word-text ${isPlaying && !isTrail ? 'is-comet' : ''} ${isSuperBright ? 'super-text' : ''}`}>
                        {wordData.text}
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

// --- COMPONENT: INTRO TEXT ---
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


// --- MAIN APP ---
export default function App() {
  const [input, setInput] = useState('');
  const [words, setWords] = useState([]);
  const [particles, setParticles] = useState([]);
  const [isPlanetOrchestra, setIsPlanetOrchestra] = useState(false); 
  const [pan, setPan] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const starBoxShadow = useMemo(() => generateStars(300), []);
  const twinklingBoxShadow = useMemo(() => generateStars(100), []);

  const { initAudio, playTone, playSequence, playPop, stopAll, fadeOut, resetVolume } = AudioEngine();
  const inputRef = useRef(null);

  const handleKeyDown = (e) => {
    initAudio();
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

    const isAlphabetical = /^[a-zA-Z]$/.test(e.key);
    if (e.key.length === 1 && isAlphabetical) {
      playTone(e.key, 0, 0.15, 'typing', 0.2); 
      setInput((prev) => prev + e.key);
    }
  };

  const handlePlanetClick = (e) => {
    e.stopPropagation();
    
    fadeOut(1.5);
    
    setTimeout(() => {
        resetVolume();
        initAudio(); 

        setIsPlanetOrchestra(true);
        
        const sortedWords = [...words].sort((a, b) => {
            if (a.text.length === b.text.length) return a.id - b.id;
            return a.text.length - b.text.length;
        });

        let totalDelay = 0;

        sortedWords.forEach((word, index) => {
            const delay = index * 400; 
            totalDelay = delay;
            
            setTimeout(() => {
                setWords(prevWords => prevWords.map(w => {
                    if (w.id === word.id) {
                        return { ...w, forceTrigger: Date.now() }; 
                    }
                    return w;
                }));
            }, delay);
        });

        setTimeout(() => {
            setIsPlanetOrchestra(false);
        }, totalDelay + 1000);

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

  const handlePlanetContextMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      playPop(); 
      spawnParticles(e.clientX, e.clientY, 'nova');
      setWords([]); 
  };

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
    e.preventDefault();
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
    setZoom(newZoom);
  }, [zoom, pan]);


  const removeWord = useCallback((id, x, y, e) => {
    e.preventDefault();
    e.stopPropagation();
    playPop();
    spawnParticles(x, y, 'pop');
    setWords((prev) => prev.filter(w => w.id !== id));
  }, [playPop, spawnParticles]);

  const processedWords = useMemo(() => {
    const sorted = [...words].sort((a, b) => {
        if (a.text.length === b.text.length) return a.id - b.id;
        return a.text.length - b.text.length;
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

  const maxRadiusVal = useMemo(() => {
    if (processedWords.length === 0) return 300; 
    return processedWords[processedWords.length - 1].radiusVal + 100; 
  }, [processedWords]);


  return (
    <div 
        ref={containerRef}
        className="zoom-container" 
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
    >
      <div className="stars" style={{ boxShadow: starBoxShadow }}></div>
      <div className="stars-twinkle" style={{ boxShadow: twinklingBoxShadow }}></div>

      <ThemeMenu words={words} setWords={setWords} />
      <InfoPanel />
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
            onClick={handlePlanetClick}
            onContextMenu={handlePlanetContextMenu}
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
        <div className="input-zone">
            <div className="current-input">
            {input}<span className="caret">|</span>
            </div>
        </div>
      </div>
      <input 
        ref={inputRef}
        className="hidden-input"
        type="text" 
        onKeyDown={handleKeyDown} 
        autoFocus
      />
    </div>
  );
}