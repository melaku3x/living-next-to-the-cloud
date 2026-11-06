# Living Next to the Cloud

What's it like to live next to a data center? Loudoun County has more of them than anywhere on earth, and I grew up in Sterling right in the middle of it. This map answers that question three ways.

- **Land.** Real satellite imagery from 2014 to now. Drag the slider and watch farmland turn into roofs.
- **Heat.** Landsat ground surface temperature from summers before and after the boom.
- **Noise.** Sound readings I took myself around data centers and nearby neighborhoods.

Click any data center and you get its story: how much land it covers, how much hotter it got around it, and how loud it is nearby.

## How it works
It's one static page, no server and no API keys.
- Imagery comes from Esri's World Imagery Wayback archive, one release per year.
- Data center buildings are pulled live from OpenStreetMap (anything tagged `building=data_center` or `telecom=data_center`).
- Heat comes from Landsat 8/9 Collection 2 surface temperature, processed in Google Earth Engine (`earth-engine/landsat_heat.js`).
- Noise is `data/noise.csv`, filled in by hand (`NOISE_GUIDE.md`).
- Built with MapLibre GL JS.

## Files
```
index.html                  the page
style.css                   the look
app.js                      everything the map does
config.js                   settings (map area, heat range, file paths)
data/noise.csv              my noise readings
data/heat/                  the two heat PNGs from Earth Engine
earth-engine/landsat_heat.js  script that makes the heat PNGs
```

## Running it on your laptop
Opening `index.html` by double-clicking won't load the heat and noise files (browsers block that). Run a tiny local server from this folder instead:
```
python -m http.server 8000
```
then go to http://localhost:8000.

## Putting it online
Same as my quake monitor: make a new GitHub repo, upload this whole folder, then Settings > Pages > deploy from the main branch.

## Limits
- Wayback starts in 2014. A lot of Ashburn was already built by then, so some sites will look the same at both ends of the slider.
- OpenStreetMap is missing some buildings and doesn't always have names. If one's missing, I can add it on openstreetmap.org and it'll show up here.
- Surface temp is the ground and roofs, not the air, and two summers are never the same weather. It's a signal, not a precise number.
- Phone sound meters aren't lab equipment, and dBA misses most of the low-frequency hum.

## Sources
Esri World Imagery Wayback · OpenStreetMap contributors · USGS Landsat Collection 2 · Loudoun County Zoning Ordinance (55 dBA residential limit) · my own readings
