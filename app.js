/* Living Next to the Cloud
   One map, one question: what's it like to live next to a data center?
   Land = Esri Wayback imagery by year. Heat = Landsat surface temp. Trees = Hansen forest loss by year. Noise = my readings. */

(() => {
  const C = window.CONFIG;
  const $ = (id) => document.getElementById(id);

  // flow-direction colors, reused everywhere
  const COL = {
    pink: "#ff3d9a", orange: "#ff7a1a", yellow: "#ffd400", lime: "#c6f432",
    green: "#2fd36b", teal: "#00d1c1", blue: "#2f8cff", violet: "#8a5cff",
    ink: "#0b0b0e", paper: "#f4f1ea", mute: "#9a97a3"
  };
  // temperature ramp, cold to hot
  const TEMP_RAMP = [COL.violet, COL.blue, COL.teal, COL.green, COL.lime, COL.yellow, COL.orange, COL.pink];
  // change ramp, cooler to hotter (centered on 0)
  const CHANGE_RAMP = [COL.blue, COL.teal, "#20202a", COL.orange, COL.pink];
  const CHANGE_RANGE = 6; // degrees C either side of zero
  // tree loss ramp, older to newer (same colors as earth-engine/tree_loss.js)
  const TREE_RAMP = [COL.yellow, COL.orange, COL.pink, COL.violet];
  const DEFAULT_HEIGHT = 20; // meters, for buildings with no height in OSM
  // Fahrenheit helpers. A temperature adds 32, a temperature CHANGE only scales by 1.8.
  const toF = (c) => c * 9 / 5 + 32;
  const dToF = (d) => d * 1.8;

  // noise stays hidden until there are readings to show
  if (!C.showNoise) {
    document.body.classList.add("hide-noise");
    const chip = document.querySelector('.chip[data-layer="noise"]');
    if (chip) chip.remove();
  }

  const state = {
    layer: "land",
    heatMode: "early",
    releases: [],        // [{year, title, tiles}]
    yearIndex: 0,
    playing: null,
    sites: null,         // GeoJSON FeatureCollection of data centers
    heat: { early: null, late: null }, // {w,h,data(Uint8)} grayscale
    trees: null,         // {w,h,data(Uint8)} grayscale, value = year code (1 = 2001)
    noise: []            // [{lat, lon, dba, datetime, place, note}]
  };

  /* ---------------- map ---------------- */

  const map = new maplibregl.Map({
    container: "map",
    center: C.center,
    zoom: C.zoom,
    minZoom: 10,
    maxZoom: 18,
    maxBounds: C.maxBounds,
    attributionControl: { compact: true },
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      sources: {
        imagery: {
          type: "raster",
          tiles: [C.liveImagery],
          tileSize: 256,
          maxzoom: 19,
          attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
        }
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": COL.ink } },
        {
          id: "imagery", type: "raster", source: "imagery",
          paint: { "raster-saturation": -0.35, "raster-contrast": 0.1, "raster-brightness-max": 0.92 }
        }
      ]
    }
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "bottom-right");

  map.on("load", () => {
    addEmptySources();
    loadWayback();
    loadSites();
    loadHeat();
    loadTrees();
    loadNoise();
    renderLegend();
  });

  function addEmptySources() {
    const empty = { type: "FeatureCollection", features: [] };

    // rings around a clicked site
    map.addSource("rings", { type: "geojson", data: empty });
    map.addLayer({
      id: "rings", type: "line", source: "rings",
      paint: { "line-color": COL.paper, "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.85 }
    });
    map.addLayer({
      id: "ring-labels", type: "symbol", source: "rings",
      layout: {
        "symbol-placement": "line", "text-field": ["get", "label"], "text-size": 11,
        "text-font": ["Open Sans Bold"], "text-letter-spacing": 0.1
      },
      paint: { "text-color": COL.paper, "text-halo-color": COL.ink, "text-halo-width": 1.5 }
    });

    // data centers
    map.addSource("sites", { type: "geojson", data: empty, promoteId: "id" });
    map.addLayer({
      id: "sites-fill", type: "fill", source: "sites",
      paint: {
        "fill-color": COL.pink,
        "fill-opacity": ["case", ["boolean", ["feature-state", "picked"], false], 0.75, 0.42]
      }
    });
    map.addLayer({
      id: "sites-line", type: "line", source: "sites",
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "picked"], false], COL.yellow, COL.pink],
        "line-width": ["case", ["boolean", ["feature-state", "picked"], false], 3, 1.4]
      }
    });
    // 3D buildings. Only shows up once you tilt the map (right-click drag or Ctrl+drag).
    map.addLayer({
      id: "sites-3d", type: "fill-extrusion", source: "sites",
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": ["case", ["boolean", ["feature-state", "picked"], false], COL.yellow, COL.pink],
        "fill-extrusion-height": ["coalesce", ["get", "height"], DEFAULT_HEIGHT],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.85,
        "fill-extrusion-vertical-gradient": true
      }
    });
    map.on("pitch", update3d);

    map.addLayer({
      id: "sites-label", type: "symbol", source: "sites", minzoom: 14.5,
      filter: ["has", "name"],
      layout: {
        "text-field": ["upcase", ["get", "name"]], "text-size": 11,
        "text-font": ["Open Sans Bold"], "text-max-width": 8, "text-letter-spacing": 0.05
      },
      paint: { "text-color": COL.paper, "text-halo-color": COL.ink, "text-halo-width": 1.6 }
    });

    // noise readings
    map.addSource("noise", { type: "geojson", data: empty });
    map.addLayer({
      id: "noise-halo", type: "circle", source: "noise",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 8, 16, 26],
        "circle-color": noiseColorExpr(), "circle-opacity": 0.22, "circle-blur": 0.6
      }
    });
    map.addLayer({
      id: "noise-dot", type: "circle", source: "noise",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 9],
        "circle-color": noiseColorExpr(),
        "circle-stroke-color": COL.ink, "circle-stroke-width": 1.5
      }
    });
    map.addLayer({
      id: "noise-label", type: "symbol", source: "noise", minzoom: 14,
      layout: {
        visibility: "none",
        "text-field": ["concat", ["to-string", ["get", "dba"]], " dBA"],
        "text-size": 11, "text-offset": [0, 1.4], "text-font": ["Open Sans Bold"]
      },
      paint: { "text-color": COL.paper, "text-halo-color": COL.ink, "text-halo-width": 1.5 }
    });

    map.on("click", (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: siteLayers() });
      if (f.length) pickSite(f[0]);
    });
    map.on("mousemove", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: siteLayers() }).length;
      map.getCanvas().style.cursor = hit ? "pointer" : "";
    });

    map.on("click", "noise-dot", (e) => {
      const p = e.features[0].properties;
      new maplibregl.Popup({ closeButton: false, className: "noise-pop" })
        .setLngLat(e.lngLat)
        .setHTML(`<b>${p.dba} dBA</b><br>${esc(p.place || "")}<br><small>${esc(p.datetime || "")}</small>${p.note ? "<br>" + esc(p.note) : ""}`)
        .addTo(map);
    });
  }

  function noiseColorExpr() {
    return ["interpolate", ["linear"], ["get", "dba"],
      35, COL.green, 45, COL.lime, 55, COL.yellow, 62, COL.orange, 70, COL.pink];
  }

  /* ---------------- land: Esri Wayback time slider ---------------- */

  async function loadWayback() {
    try {
      const res = await fetch(C.waybackConfig);
      if (!res.ok) throw new Error(res.status);
      const cfg = await res.json();

      // one release per year: the latest one published that year
      const byYear = {};
      for (const [num, r] of Object.entries(cfg)) {
        const m = /(\d{4})-(\d{2})-(\d{2})/.exec(r.itemTitle || "");
        if (!m || !r.itemURL) continue;
        const year = +m[1];
        const date = m[0];
        const tiles = r.itemURL
          .replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}");
        if (!byYear[year] || byYear[year].date < date) {
          byYear[year] = { year, date, num: +num, tiles };
        }
      }
      state.releases = Object.values(byYear).sort((a, b) => a.year - b.year);
      if (!state.releases.length) throw new Error("no releases");

      const slider = $("yearSlider");
      slider.max = state.releases.length - 1;
      slider.value = state.releases.length - 1;
      buildTicks();
      setYear(state.releases.length - 1);
      $("imgStatus").textContent =
        `Esri Wayback archive, ${state.releases[0].year} to ${state.releases.at(-1).year}. Drag it back and watch the fields come back.`;
    } catch (err) {
      console.warn("Wayback failed, using live imagery", err);
      $("yearSlider").disabled = true;
      $("playBtn").disabled = true;
      $("yearReadout").textContent = "Today";
      $("imgStatus").textContent = "Couldn't load the imagery archive, so this is today's imagery only. Try refreshing.";
    }
  }

  function buildTicks() {
    const ticks = $("ticks");
    ticks.innerHTML = "";
    const n = state.releases.length;
    state.releases.forEach((r, i) => {
      const s = document.createElement("span");
      s.style.left = n === 1 ? "50%" : `calc(${(i / (n - 1)) * 100}% + ${8 - (i / (n - 1)) * 16}px)`;
      s.textContent = "'" + String(r.year).slice(2);
      ticks.appendChild(s);
    });
  }

  function setYear(i) {
    const r = state.releases[i];
    if (!r) return;
    state.yearIndex = i;
    $("yearSlider").value = i;
    $("yearReadout").textContent = r.year;
    map.getSource("imagery").setTiles([r.tiles]);
  }

  $("yearSlider").addEventListener("input", (e) => { stopPlay(); setYear(+e.target.value); });

  $("playBtn").addEventListener("click", () => {
    if (state.playing) return stopPlay();
    if (state.yearIndex >= state.releases.length - 1) setYear(0);
    $("playBtn").classList.add("on");
    $("playBtn").innerHTML = "&#10074;&#10074;";
    state.playing = setInterval(() => {
      if (state.yearIndex >= state.releases.length - 1) return stopPlay();
      setYear(state.yearIndex + 1);
    }, 1400);
  });

  function stopPlay() {
    clearInterval(state.playing);
    state.playing = null;
    $("playBtn").classList.remove("on");
    $("playBtn").innerHTML = "&#9654;";
  }

  /* ---------------- data centers from OpenStreetMap ---------------- */

  function showSites(json) {
    state.sites = overpassToGeoJSON(json);
    map.getSource("sites").setData(state.sites);
    renderLegend();
  }

  async function loadSites() {
    // 1. saved copy in the repo: fast and always there
    try {
      const res = await fetch(C.sitesFile, { cache: "no-cache" });
      if (res.ok) {
        const json = await res.json();
        if (json.elements && json.elements.length) return showSites(json);
      }
    } catch (err) {
      console.warn("No saved data center file, trying live", err);
    }

    // 2. live from OpenStreetMap
    const [s, w, n, e] = C.overpassBox;
    const bbox = `${s},${w},${n},${e}`;
    const q = `[out:json][timeout:60];
      (
        way["building"="data_center"](${bbox});
        way["telecom"="data_center"](${bbox});
        relation["building"="data_center"](${bbox});
        relation["telecom"="data_center"](${bbox});
      );
      out geom;`;

    for (const url of C.overpass) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: "data=" + encodeURIComponent(q)
        });
        if (!res.ok) throw new Error(res.status);
        const json = await res.json();
        try { localStorage.setItem("lnttc-sites", JSON.stringify(json)); } catch (_) {}
        return showSites(json);
      } catch (err) {
        console.warn("Overpass failed at", url, err);
      }
    }

    // 3. last copy this browser got
    try {
      const cached = localStorage.getItem("lnttc-sites");
      if (cached) return showSites(JSON.parse(cached));
    } catch (_) {}

    state.sites = { type: "FeatureCollection", features: [], failed: true };
    renderLegend();
  }

  // Building height in meters. Uses OSM height if it's there, otherwise floors x 5 m
  // (data center floors are tall), otherwise a typical two story data center.
  function buildingHeight(tags) {
    const h = parseFloat(tags.height);
    if (h > 0) return h;
    const lv = parseFloat(tags["building:levels"]);
    if (lv > 0) return lv * 5;
    return DEFAULT_HEIGHT;
  }

  function siteLayers() {
    return map.getLayer("sites-3d") && map.getLayoutProperty("sites-3d", "visibility") === "visible"
      ? ["sites-3d", "sites-fill"] : ["sites-fill"];
  }

  function update3d() {
    if (!map.getLayer("sites-3d")) return;
    map.setLayoutProperty("sites-3d", "visibility", map.getPitch() > 8 ? "visible" : "none");
  }

  function overpassToGeoJSON(json) {
    const features = [];
    for (const el of json.elements || []) {
      let rings = [];
      if (el.type === "way" && el.geometry) {
        rings = [el.geometry.map((p) => [p.lon, p.lat])];
      } else if (el.type === "relation" && el.members) {
        rings = el.members
          .filter((m) => m.role === "outer" && m.geometry)
          .map((m) => m.geometry.map((p) => [p.lon, p.lat]));
      }
      rings = rings.filter((r) => r.length >= 4);
      if (!rings.length) continue;
      rings.forEach((r) => {
        const a = r[0], b = r.at(-1);
        if (a[0] !== b[0] || a[1] !== b[1]) r.push(a);
      });
      const tags = el.tags || {};
      features.push({
        type: "Feature",
        id: features.length + 1,
        properties: {
          id: features.length + 1,
          osm: `${el.type}/${el.id}`,
          name: tags.name || tags["name:en"] || undefined,
          operator: tags.operator || tags.owner || undefined,
          height: buildingHeight(tags),
          tags: JSON.stringify(tags)
        },
        geometry: rings.length === 1
          ? { type: "Polygon", coordinates: rings }
          : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) }
      });
    }
    return { type: "FeatureCollection", features };
  }

  /* ---------------- heat: Landsat surface temperature ---------------- */

  async function loadHeat() {
    const [early, late] = await Promise.all([readGray(C.heat.early.file), readGray(C.heat.late.file)]);
    state.heat.early = early;
    state.heat.late = late;
    if (early || late) drawHeat();
    renderLegend();
  }

  // load a grayscale PNG and keep its raw values for sampling
  function readGray(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const vals = new Uint8Array(cv.width * cv.height);
        for (let i = 0; i < vals.length; i++) {
          vals[i] = px[i * 4 + 3] < 128 ? 0 : px[i * 4]; // transparent = no data
        }
        resolve({ w: cv.width, h: cv.height, data: vals });
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  const toC = (v) => C.heat.minC + ((v - 1) / 254) * (C.heat.maxC - C.heat.minC);

  function drawHeat() {
    const { early, late } = state.heat;
    let base = state.heatMode === "late" ? late : early;
    if (state.heatMode === "change") base = early && late ? early : null;
    if (!base) {
      if (map.getLayer("heat")) map.setLayoutProperty("heat", "visibility", "none");
      return;
    }

    const cv = document.createElement("canvas");
    cv.width = base.w; cv.height = base.h;
    const ctx = cv.getContext("2d");
    const out = ctx.createImageData(base.w, base.h);
    const tempStops = TEMP_RAMP.map(hexToRgb);
    const chgStops = CHANGE_RAMP.map(hexToRgb);

    for (let i = 0; i < base.data.length; i++) {
      let rgb = null;
      if (state.heatMode === "change") {
        const a = early.data[i], b = late.w === early.w ? late.data[i] : 0;
        if (a && b) {
          const d = toC(b) - toC(a);
          rgb = rampAt(chgStops, (d + CHANGE_RANGE) / (2 * CHANGE_RANGE));
        }
      } else if (base.data[i]) {
        rgb = rampAt(tempStops, (base.data[i] - 1) / 254);
      }
      if (rgb) {
        out.data[i * 4] = rgb[0]; out.data[i * 4 + 1] = rgb[1]; out.data[i * 4 + 2] = rgb[2];
        out.data[i * 4 + 3] = 215;
      }
    }
    ctx.putImageData(out, 0, 0);

    const [w, s, e, n] = C.heat.bounds;
    const coords = [[w, n], [e, n], [e, s], [w, s]];
    const url = cv.toDataURL("image/png");
    if (map.getSource("heat")) {
      map.getSource("heat").updateImage({ url, coordinates: coords });
    } else {
      map.addSource("heat", { type: "image", url, coordinates: coords });
      map.addLayer({
        id: "heat", type: "raster", source: "heat",
        layout: { visibility: state.layer === "heat" ? "visible" : "none" },
        paint: { "raster-opacity": 0.78, "raster-resampling": "nearest" }
      }, "rings");
    }
  }

  // mean surface temp within radius (m) of a point
  function sampleHeat(grid, lng, lat, radius) {
    if (!grid) return null;
    const [w, s, e, n] = C.heat.bounds;
    if (lng < w || lng > e || lat < s || lat > n) return null;
    const mPerLat = 111320, mPerLng = 111320 * Math.cos((lat * Math.PI) / 180);
    const px = (lng - w) / (e - w) * grid.w, py = (n - lat) / (n - s) * grid.h;
    const rx = radius / mPerLng / (e - w) * grid.w, ry = radius / mPerLat / (n - s) * grid.h;
    let sum = 0, cnt = 0;
    for (let y = Math.floor(py - ry); y <= Math.ceil(py + ry); y++) {
      for (let x = Math.floor(px - rx); x <= Math.ceil(px + rx); x++) {
        if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
        const dx = (x - px) / rx, dy = (y - py) / ry;
        if (dx * dx + dy * dy > 1) continue;
        const v = grid.data[y * grid.w + x];
        if (v) { sum += toC(v); cnt++; }
      }
    }
    return cnt ? sum / cnt : null;
  }

  /* ---------------- trees: Hansen forest loss ---------------- */

  const treeYear = (v) => C.trees.firstYear + v - 1;  // pixel value -> calendar year
  const treeSpan = () => C.trees.lastYear - C.trees.firstYear;

  async function loadTrees() {
    state.trees = await readGray(C.trees.file);
    if (state.trees) drawTrees();
    renderLegend();
  }

  // color each cleared pixel by year, same overlay approach as drawHeat
  function drawTrees() {
    const g = state.trees;
    const cv = document.createElement("canvas");
    cv.width = g.w; cv.height = g.h;
    const ctx = cv.getContext("2d");
    const out = ctx.createImageData(g.w, g.h);
    const stops = TREE_RAMP.map(hexToRgb);
    const maxV = treeSpan() + 1;

    for (let i = 0; i < g.data.length; i++) {
      const v = g.data[i];
      if (!v || v > maxV) continue;
      const rgb = rampAt(stops, (v - 1) / (maxV - 1));
      out.data[i * 4] = rgb[0]; out.data[i * 4 + 1] = rgb[1]; out.data[i * 4 + 2] = rgb[2];
      out.data[i * 4 + 3] = 230;
    }
    ctx.putImageData(out, 0, 0);

    const [w, s, e, n] = C.trees.bounds;
    map.addSource("trees", { type: "image", url: cv.toDataURL("image/png"), coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    map.addLayer({
      id: "trees", type: "raster", source: "trees",
      layout: { visibility: state.layer === "trees" ? "visible" : "none" },
      paint: { "raster-opacity": 0.85, "raster-resampling": "nearest" }
    }, "rings");
  }

  // Forest cleared under a building and within `radius` meters around it.
  // Reads pixels the same way sampleHeat does (straight lat/lon grid), but checks each
  // pixel center against the building outline instead of a circle around the middle.
  // Returns { under, near } in m2 per year code, or null if the site is off the PNG.
  function sampleTrees(grid, geom, radius) {
    if (!grid) return null;
    const [w, s, e, n] = C.trees.bounds;
    const rs = rings(geom);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rs.forEach((r) => r.forEach(([a, b]) => {
      x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b);
    }));
    if (x1 < w || x0 > e || y1 < s || y0 > n) return null;

    const lat0 = (y0 + y1) / 2;
    const mPerLat = 111320, mPerLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const pxW = (e - w) / grid.w, pxH = (n - s) / grid.h;          // degrees per pixel
    const pxArea = pxW * mPerLng * pxH * mPerLat;                     // m2 per pixel
    const padX = radius / mPerLng, padY = radius / mPerLat;
    const cx0 = Math.max(0, Math.floor((x0 - padX - w) / pxW)), cx1 = Math.min(grid.w - 1, Math.floor((x1 + padX - w) / pxW));
    const cy0 = Math.max(0, Math.floor((n - y1 - padY) / pxH)), cy1 = Math.min(grid.h - 1, Math.floor((n - y0 + padY) / pxH));

    // rings in local meters, so distances are easy
    const toM = ([a, b]) => [(a - x0) * mPerLng, (b - y0) * mPerLat];
    const mr = rs.map((r) => r.map(toM));
    const under = {}, near = {};

    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        const v = grid.data[y * grid.w + x];
        if (!v) continue;
        const p = toM([w + (x + 0.5) * pxW, n - (y + 0.5) * pxH]);
        if (mr.some((r) => insideRing(p, r))) under[v] = (under[v] || 0) + pxArea;
        else if (Math.min(...mr.map((r) => distToRing(p, r))) <= radius) near[v] = (near[v] || 0) + pxArea;
      }
    }
    return { under, near };
  }

  function insideRing([px, py], r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distToRing([px, py], r) {
    let best = Infinity;
    for (let i = 0; i < r.length - 1; i++) {
      const [ax, ay] = r[i], [bx, by] = r[i + 1];
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return best;
  }

  /* ---------------- noise: my readings ---------------- */

  async function loadNoise() {
    try {
      const res = await fetch(C.noiseCsv, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      state.noise = parseCsv(await res.text())
        .map((r) => ({ ...r, lat: +r.lat, lon: +r.lon, dba: +r.dba }))
        .filter((r) => isFinite(r.lat) && isFinite(r.lon) && isFinite(r.dba) && r.dba > 0);
    } catch (err) {
      console.warn("No noise CSV", err);
      state.noise = [];
    }
    map.getSource("noise").setData({
      type: "FeatureCollection",
      features: state.noise.map((r) => ({
        type: "Feature",
        properties: { dba: r.dba, place: r.place, datetime: r.datetime, note: r.note },
        geometry: { type: "Point", coordinates: [r.lon, r.lat] }
      }))
    });
    renderLegend();
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((c) => c.trim() !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    if (!rows.length) return [];
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    return rows
      .filter((r) => !String(r[0]).trim().startsWith("#"))
      .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }

  // decibels don't average like normal numbers, so convert to energy first
  const energyMean = (arr) => 10 * Math.log10(arr.reduce((s, d) => s + Math.pow(10, d / 10), 0) / arr.length);

  /* ---------------- layer switching ---------------- */

  document.querySelectorAll(".chip").forEach((btn) =>
    btn.addEventListener("click", () => setLayer(btn.dataset.layer)));

  document.querySelectorAll("#heatMode button").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.heatMode = btn.dataset.mode;
      document.querySelectorAll("#heatMode button").forEach((b) => b.classList.toggle("on", b === btn));
      drawHeat();
      if (map.getLayer("heat")) map.setLayoutProperty("heat", "visibility", "visible");
      renderLegend();
    }));

  function setLayer(layer) {
    state.layer = layer;
    document.querySelectorAll(".chip").forEach((b) => b.classList.toggle("on", b.dataset.layer === layer));
    $("heatMode").classList.toggle("hidden", layer !== "heat");
    $("timeline").classList.toggle("hidden", layer !== "land");
    if (layer !== "land") stopPlay();

    // imagery goes quieter when another layer is the star
    map.setPaintProperty("imagery", "raster-saturation", layer === "land" ? -0.35 : -1);
    map.setPaintProperty("imagery", "raster-brightness-max", layer === "land" ? 0.92 : 0.45);
    if (layer !== "land" && state.releases.length) setYear(state.releases.length - 1);

    if (map.getLayer("heat")) map.setLayoutProperty("heat", "visibility", layer === "heat" ? "visible" : "none");
    if (map.getLayer("trees")) map.setLayoutProperty("trees", "visibility", layer === "trees" ? "visible" : "none");
    ["noise-halo", "noise-dot", "noise-label"].forEach((id) =>
      map.setLayoutProperty(id, "visibility", layer === "noise" ? "visible" : "none"));
    if (map.getLayer("sites-3d")) map.setPaintProperty("sites-3d", "fill-extrusion-opacity", layer === "land" ? 0.85 : 0.5);
    map.setPaintProperty("sites-fill", "fill-opacity",
      ["case", ["boolean", ["feature-state", "picked"], false], layer === "land" ? 0.75 : 0.35, layer === "land" ? 0.42 : 0.12]);
    // pink/yellow outlines blend into the tree loss colors, so use white/teal on Trees
    const trees = layer === "trees";
    map.setPaintProperty("sites-line", "line-color",
      ["case", ["boolean", ["feature-state", "picked"], false], trees ? COL.teal : COL.yellow, trees ? COL.paper : COL.pink]);

    document.querySelector(".legend").style.bottom = layer === "land" ? "" : "20px";
    $("panel").style.bottom = layer === "land" ? "" : "20px";
    renderLegend();
  }

  function renderLegend() {
    const L = $("legend");
    if (state.layer === "land") {
      const n = state.sites ? state.sites.features.length : null;
      L.innerHTML = `
        <h4>Land</h4>
        <div class="row"><span class="sw" style="background:${COL.pink};opacity:.7;outline:1.5px solid ${COL.pink}"></span>
          Data center building ${n === null ? "(loading...)" : state.sites.failed ? "(couldn&#39;t load)" : `(${n} mapped)`}</div>
        <p class="note">Outlines are today's buildings from OpenStreetMap. The photo under them changes with the slider, so drag it back and the outlines end up sitting on top of whatever was there before.</p>`;
    } else if (state.layer === "heat") {
      const have = state.heat.early || state.heat.late;
      if (!have) {
        L.innerHTML = `<h4>Heat</h4><p class="note">No heat data loaded yet. Run <b>earth-engine/landsat_heat.js</b> and drop the two PNGs into <b>data/heat/</b>.</p>`;
        return;
      }
      if (state.heatMode === "change") {
        L.innerHTML = `
          <h4>Surface temp change, then to now</h4>
          <div class="ramp" style="background:linear-gradient(90deg,${CHANGE_RAMP.join(",")})"></div>
          <div class="ends"><span>-${CHANGE_RANGE}&deg;C / -${Math.round(dToF(CHANGE_RANGE))}&deg;F</span><span>0</span><span>+${CHANGE_RANGE}&deg;C / +${Math.round(dToF(CHANGE_RANGE))}&deg;F</span></div>
          <p class="note">${C.heat.early.label} vs ${C.heat.late.label}. Median of clear summer days.</p>`;
      } else {
        const lbl = state.heatMode === "late" ? C.heat.late.label : C.heat.early.label;
        L.innerHTML = `
          <h4>Ground surface temp</h4>
          <div class="ramp" style="background:linear-gradient(90deg,${TEMP_RAMP.join(",")})"></div>
          <div class="ends"><span>${C.heat.minC}&deg;C / ${Math.round(toF(C.heat.minC))}&deg;F</span><span>${C.heat.maxC}&deg;C / ${Math.round(toF(C.heat.maxC))}&deg;F</span></div>
          <p class="note">${lbl}. This is how hot the ground and roofs get, not the air. Median of clear summer days.</p>`;
      }
    } else if (state.layer === "trees") {
      if (!state.trees) {
        L.innerHTML = `<h4>Trees</h4><p class="note">No tree data loaded yet. Run <b>earth-engine/tree_loss.js</b> and drop tree_loss.png into <b>data/trees/</b>.</p>`;
        return;
      }
      L.innerHTML = `
        <h4>Forest cleared ${C.trees.firstYear}&ndash;${C.trees.lastYear}</h4>
        <div class="ramp" style="background:linear-gradient(90deg,${TREE_RAMP.join(",")})"></div>
        <div class="ends"><span>${C.trees.firstYear}</span><span>${C.trees.lastYear}</span></div>
        <p class="note">Color is the year the trees came down. Source: Hansen/UMD Global Forest Change v1.12.</p>`;
    } else {
      const n = state.noise.length;
      const stops = [[35, COL.green], [45, COL.lime], [55, COL.yellow], [62, COL.orange], [70, COL.pink]];
      L.innerHTML = `
        <h4>Noise readings</h4>
        <div class="ramp" style="background:linear-gradient(90deg,${stops.map((s) => s[1]).join(",")})"></div>
        <div class="ends">${stops.map((s) => `<span>${s[0]}</span>`).join("")}</div>
        <p class="note">dBA. The county limit at a home's property line is <b>${C.noiseLimit} dBA</b>.
        ${n ? `${n} readings so far.` : "No readings yet. See NOISE_GUIDE.md to add them."}</p>`;
    }
  }

  /* ---------------- clicking a site ---------------- */

  let pickedId = null;
  let viewBeforePick = null;

  function pickSite(f) {
    if (pickedId !== null) map.setFeatureState({ source: "sites", id: pickedId }, { picked: false });
    pickedId = f.id;
    map.setFeatureState({ source: "sites", id: pickedId }, { picked: true });

    // use the full geometry from our own data (rendered features can be clipped to tiles)
    const full = state.sites.features.find((x) => x.id === f.id) || f;
    const [lng, lat] = centroid(full.geometry);
    const areaM2 = geomArea(full.geometry);
    const tags = JSON.parse(full.properties.tags || "{}");

    map.getSource("rings").setData({
      type: "FeatureCollection",
      features: [circle(lng, lat, 500, "500 M"), circle(lng, lat, 1000, "1 KM")]
    });
    // remember where you were before the first click, so closing the panel takes you back
    if (!viewBeforePick) viewBeforePick = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14.2), offset: window.innerWidth > 760 ? [-160, 0] : [0, -120], duration: 700 });

    const title = full.properties.name || "Unnamed data center";
    const op = full.properties.operator;
    const acres = areaM2 / 4046.86;
    const fields = Math.round(areaM2 / 5351); // one American football field incl. end zones

    $("panelBody").innerHTML = `
      <p class="kicker">Data center</p>
      <h2>${esc(title)}</h2>
      <p class="op">${op ? esc(op) + " &middot; " : ""}${lat.toFixed(4)}, ${lng.toFixed(4)}</p>

      <div class="block" style="--c:${COL.pink}">
        <h3>Land</h3>
        <div class="big">${acres >= 1 ? acres.toFixed(1) : acres.toFixed(2)}<small>acres of roof</small></div>
        <p>About ${fields || "less than 1"} football field${fields === 1 ? "" : "s"}. Jump back in time to see what this spot was before.</p>
        ${state.releases.length ? `
          <button type="button" data-go="first">See ${state.releases[0].year}</button>
          <button type="button" data-go="last">See ${state.releases.at(-1).year}</button>
          <button type="button" data-go="play">Play it</button>` : ""}
      </div>

      ${heatBlock(lng, lat)}
      ${treesBlock(full.geometry)}
      ${C.showNoise ? noiseBlock(lng, lat) : ""}

      <ul class="tags">
        ${Object.entries(tags).slice(0, 10).map(([k, v]) => `<li>${esc(k)} = ${esc(v)}</li>`).join("")}
        <li><a href="https://www.openstreetmap.org/${full.properties.osm}" target="_blank" rel="noopener" style="color:inherit">View on OpenStreetMap</a></li>
      </ul>`;

    $("panel").classList.remove("hidden");
    document.body.classList.add("panel-open");

    $("panelBody").querySelectorAll("[data-go]").forEach((b) =>
      b.addEventListener("click", () => {
        setLayer("land");
        if (b.dataset.go === "first") { stopPlay(); setYear(0); }
        if (b.dataset.go === "last") { stopPlay(); setYear(state.releases.length - 1); }
        if (b.dataset.go === "play") { stopPlay(); setYear(0); $("playBtn").click(); }
      }));
    $("panelBody").querySelectorAll("[data-layer]").forEach((b) =>
      b.addEventListener("click", () => setLayer(b.dataset.layer)));
  }

  function heatBlock(lng, lat) {
    const { early, late } = state.heat;
    if (!early && !late) {
      return `<div class="block" style="--c:${COL.orange}"><h3>Heat</h3>
        <p class="empty">Heat data isn't loaded yet.</p></div>`;
    }
    const e0 = sampleHeat(early, lng, lat, 120), l0 = sampleHeat(late, lng, lat, 120);
    const e1 = sampleHeat(early, lng, lat, 500), l1 = sampleHeat(late, lng, lat, 500);
    if (e0 === null && l0 === null) {
      return `<div class="block" style="--c:${COL.orange}"><h3>Heat</h3>
        <p class="empty">This site is outside the area I processed for heat.</p></div>`;
    }
    const f = (c) => (c === null ? "--" : `${c.toFixed(1)}&deg;C (${toF(c).toFixed(0)}&deg;F)`);
    const d = e1 !== null && l1 !== null ? l1 - e1 : null;
    return `<div class="block" style="--c:${COL.orange}">
      <h3>Heat</h3>
      ${d !== null ? `<div class="big">${d >= 0 ? "+" : ""}${d.toFixed(1)}&deg;C<small>${d >= 0 ? "+" : "-"}${Math.abs(dToF(d)).toFixed(1)}&deg;F within 500 m</small></div>` : ""}
      <p>On the site: ${f(e0)} then, ${f(l0)} now.<br>Within 500 m: ${f(e1)} then, ${f(l1)} now.</p>
      <p style="color:${COL.mute};font-size:12px">Ground surface on clear summer days, ${esc(C.heat.early.label.toLowerCase())} vs ${esc(C.heat.late.label.toLowerCase())}. Weather differs year to year, so read this as a rough signal, not an exact number.</p>
      <button type="button" data-layer="heat">Show heat map</button>
    </div>`;
  }

  function treesBlock(geom) {
    if (!state.trees) {
      return `<div class="block" style="--c:${COL.green}"><h3>Trees</h3>
        <p class="empty">Tree data isn't loaded yet.</p></div>`;
    }
    const r = sampleTrees(state.trees, geom, C.trees.nearbyMeters);
    if (!r) {
      return `<div class="block" style="--c:${COL.green}"><h3>Trees</h3>
        <p class="empty">This site is outside the area I processed for trees.</p></div>`;
    }
    const ac = (m2) => m2 / 4046.86;
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const fmt = (a) => (a >= 1 ? a.toFixed(1) : a.toFixed(2));
    const under = ac(sum(r.under)), near = ac(sum(r.near));
    const byYear = {};
    for (const o of [r.under, r.near]) for (const [v, m2] of Object.entries(o)) byYear[v] = (byYear[v] || 0) + m2;
    const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
    const m = C.trees.nearbyMeters;

    if (!years.length) {
      return `<div class="block" style="--c:${COL.green}">
        <h3>Trees</h3>
        <p class="empty">No forest cleared here or within ${m} m between ${C.trees.firstYear} and ${C.trees.lastYear}. It was probably already farmland or cleared before then.</p>
        <button type="button" data-layer="trees">Show tree map</button>
      </div>`;
    }
    const yearList = years.map((v) => {
      const rgb = rampAt(TREE_RAMP.map(hexToRgb), (v - 1) / treeSpan()).map(Math.round);
      return `<span style="color:rgb(${rgb.join(",")})">${treeYear(v)}</span> (${fmt(ac(byYear[v]))} ac)`;
    }).join(", ");
    return `<div class="block" style="--c:${COL.green}">
      <h3>Trees</h3>
      <div class="big">${fmt(under + near)}<small>acres of forest cleared</small></div>
      <p>Under the building: ${fmt(under)} acres. Within ${m} m around it: ${fmt(near)} acres.</p>
      <p>Cleared in ${yearList}.</p>
      <p style="color:${COL.mute};font-size:12px">Hansen/UMD Global Forest Change, ${C.trees.firstYear} to ${C.trees.lastYear}. 30 m Landsat pixels, so small patches and single trees don't show up. Read this as a rough number.</p>
      <button type="button" data-layer="trees">Show tree map</button>
    </div>`;
  }

  function noiseBlock(lng, lat) {
    const near = state.noise
      .map((r) => ({ ...r, dist: haversine(lng, lat, r.lon, r.lat) }))
      .filter((r) => r.dist <= C.noiseNearbyMeters)
      .sort((a, b) => a.dist - b.dist);
    if (!near.length) {
      return `<div class="block" style="--c:${COL.lime}"><h3>Noise</h3>
        <p class="empty">No readings within ${C.noiseNearbyMeters / 1000} km yet.</p></div>`;
    }
    const avg = energyMean(near.map((r) => r.dba));
    const max = Math.max(...near.map((r) => r.dba));
    const over = near.filter((r) => r.dba > C.noiseLimit).length;
    const pct = (v) => Math.min(100, Math.max(0, ((v - 30) / 50) * 100)); // bar runs 30 to 80 dBA
    return `<div class="block" style="--c:${COL.lime}">
      <h3>Noise</h3>
      <div class="big">${avg.toFixed(0)}<small>dBA average</small></div>
      <div class="bar"><b style="width:${pct(avg)}%"></b><span class="limit" style="left:${pct(C.noiseLimit)}%" title="County limit"></span></div>
      <p>${near.length} reading${near.length === 1 ? "" : "s"} within ${C.noiseNearbyMeters / 1000} km. Loudest was ${max.toFixed(0)} dBA.
      ${over ? `<b>${over}</b> went over the ${C.noiseLimit} dBA residential limit.` : `None went over the ${C.noiseLimit} dBA residential limit.`}
      Closest one was ${Math.round(near[0].dist)} m away.</p>
      <button type="button" data-layer="noise">Show noise map</button>
    </div>`;
  }

  $("closePanel").addEventListener("click", () => {
    $("panel").classList.add("hidden");
    document.body.classList.remove("panel-open");
    if (pickedId !== null) map.setFeatureState({ source: "sites", id: pickedId }, { picked: false });
    pickedId = null;
    map.getSource("rings").setData({ type: "FeatureCollection", features: [] });
    if (viewBeforePick) {
      map.easeTo({ ...viewBeforePick, duration: 800 });
      viewBeforePick = null;
    }
  });

  /* ---------------- about ---------------- */

  $("aboutBtn").addEventListener("click", () => $("about").showModal());
  $("closeAbout").addEventListener("click", () => $("about").close());
  try {
    if (!localStorage.getItem("lnttc-seen")) {
      $("about").showModal();
      localStorage.setItem("lnttc-seen", "1");
    }
  } catch (_) { /* storage blocked, skip auto-open */ }

  /* ---------------- geometry helpers ---------------- */

  function rings(g) { return g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]); }

  function centroid(g) {
    let x = 0, y = 0, n = 0;
    rings(g).forEach((r) => r.slice(0, -1).forEach(([a, b]) => { x += a; y += b; n++; }));
    return [x / n, y / n];
  }

  function geomArea(g) {
    return rings(g).reduce((sum, r) => {
      const lat0 = r[0][1] * Math.PI / 180;
      const kx = 111320 * Math.cos(lat0), ky = 110540;
      let a = 0;
      for (let i = 0; i < r.length - 1; i++) {
        a += r[i][0] * kx * r[i + 1][1] * ky - r[i + 1][0] * kx * r[i][1] * ky;
      }
      return sum + Math.abs(a / 2);
    }, 0);
  }

  function haversine(lng1, lat1, lng2, lat2) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function circle(lng, lat, meters, label) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const t = (i / 96) * 2 * Math.PI;
      pts.push([
        lng + (meters * Math.cos(t)) / (111320 * Math.cos(lat * Math.PI / 180)),
        lat + (meters * Math.sin(t)) / 110540
      ]);
    }
    return { type: "Feature", properties: { label }, geometry: { type: "LineString", coordinates: pts } };
  }

  /* ---------------- color helpers ---------------- */

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

  function rampAt(stops, t) {
    t = Math.min(1, Math.max(0, t));
    const pos = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(pos)), f = pos - i;
    const a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
