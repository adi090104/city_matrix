## Live City (Top View) — Three.js

Procedural, cartoon-ish **3D top-down city** with **animated traffic**, buildings, trees, sidewalks, crosswalks, street lights, and a subtle outline look.

### Run it

Because this uses ES module imports, open it through a local server (not `file://`).

From the workspace root:

```bash
cd "city"
python3 -m http.server 5173
```

Then open:

- `http://localhost:5173`

### Controls

- **Mouse**: drag rotate, scroll zoom, right-drag pan
- **R**: regenerate a new city
- **T**: toggle traffic
- **L**: toggle street lights / signals behavior
- **O**: toggle outline effect (if supported)

### Simulation note

You don’t live in the city—you live in its model, updated every second by what you do.  
Every step becomes data, every pattern becomes a rule, and the rules quietly reshape the streets.  
City is where you see the code running underneath, and decide whether to follow it or rewrite it.

This code was created in Cursor.

