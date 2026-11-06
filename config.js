// Settings for the map. Everything you'd normally want to change lives here.
window.CONFIG = {
  // Starting view: Ashburn / Sterling, the heart of Data Center Alley
  center: [-77.475, 39.015],
  zoom: 12.2,

  // Area the map is allowed to pan around (eastern Loudoun plus a little margin)
  maxBounds: [[-77.80, 38.85], [-77.20, 39.20]],

  // Esri Wayback catalog. Lists every archived release of World Imagery.
  waybackConfig: "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json",
  // Live World Imagery, used if the Wayback catalog can't load
  liveImagery: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",

  // OpenStreetMap data centers, pulled live from the Overpass API
  overpass: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ],
  // south, west, north, east
  overpassBox: [38.85, -77.80, 39.20, -77.20],

  // Heat layer. Exported from earth-engine/landsat_heat.js.
  // PNGs are grayscale: 0 = minC, 255 = maxC. Black/transparent = no data.
  heat: {
    bounds: [-77.62, 38.93, -77.32, 39.10],   // west, south, east, north (must match the Earth Engine script)
    minC: 20,
    maxC: 55,
    early: { file: "data/heat/lst_early.png", label: "Summers 2014 to 2016" },
    late:  { file: "data/heat/lst_late.png",  label: "Summers 2023 to 2025" }
  },

  // Noise readings you collect. See NOISE_GUIDE.md.
  noiseCsv: "data/noise.csv",
  noiseLimit: 55,            // dBA, Loudoun residential property line limit
  noiseNearbyMeters: 1000    // radius used when summarizing readings near a clicked building
};
