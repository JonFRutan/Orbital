from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import time

app = Flask(__name__)
CORS(app)

DATABASE_FILE = 'systems.json'

#initialize the JSON file if it doesn't exist
if not os.path.exists(DATABASE_FILE):
    with open(DATABASE_FILE, 'w') as f:
        json.dump([], f)

#read in the database for existing systems
def read_db():
    with open(DATABASE_FILE, 'r') as f:
        return json.load(f)

#update the database file with new systems
def write_db(data):
    with open(DATABASE_FILE, 'w') as f:
        json.dump(data, f, indent=4)

#API route to grab systems, returns a JSON read from the database
@app.route('/api/systems', methods=['GET'])
def get_systems():
    return jsonify(read_db())

#publishing route, takes in the new JSON data and puts it inside of our database json
@app.route('/api/publish', methods=['POST'])
def publish_system():
    data = request.json
    systems = read_db()
    
    new_system = {
        "id": int(time.time() * 1000),
        "name": data.get('name', 'Untitled'),
        "composer": data.get('composer', 'Anonymous'),
        "description": data.get('desc', "Nothing of note."),
        "code": data.get('code'),
        "hex": data.get('hex', '#8daabf'),
        "clicks": 0,
        "date": time.strftime("%Y-%m-%d")
    }
    
    systems.append(new_system)
    write_db(systems)
    return jsonify(new_system), 201

#keeps track of how many times a certain system is clicked on
@app.route('/api/click/<int:system_id>', methods=['POST'])
def increment_click(system_id):
    systems = read_db()
    for s in systems:
        if s['id'] == system_id:
            s['clicks'] += 1
            write_db(systems)
            return jsonify(s)
    return jsonify({"error": "Not found"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)