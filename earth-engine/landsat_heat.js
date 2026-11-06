// Living Next to the Cloud: heat layer
// Paste this into the Google Earth Engine Code Editor (code.earthengine.google.com) and hit Run.
// It makes two grayscale PNGs of summer ground surface temperature for eastern Loudoun:
//   lst_early.png  = summers 2014 to 2016
//   lst_late.png   = summers 2023 to 2025
// Download links show up in the Console tab on the right. Save both into data/heat/ in the project.

// ---- settings (bounds must match config.js -> heat.bounds) ----
var WEST = -77.62, SOUTH = 38.93, EAST = -77.32, NORTH = 39.10;
var MIN_C = 20, MAX_C = 55;          // must match config.js -> heat.minC / maxC
var EARLY = [2014, 2016];
var LATE  = [2023, 2025];
var WIDTH = 1600;                    // output width in pixels (~19 m per pixel here)

var region = ee.Geometry.Rectangle([WEST, SOUTH, EAST, NORTH], 'EPSG:4326', false);

// Landsat 8 and 9, Collection 2 Level 2 (has surface temperature already calculated)
var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(region);

// mask clouds, cloud shadow, snow, then convert band ST_B10 to degrees C
function surfaceTempC(img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 1).eq(0)   // dilated cloud
    .and(qa.bitwiseAnd(1 << 3).eq(0))       // cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0))       // cloud shadow
    .and(qa.bitwiseAnd(1 << 5).eq(0));      // snow
  return img.select('ST_B10')
    .multiply(0.00341802).add(149.0)        // official scale and offset -> Kelvin
    .subtract(273.15)
    .rename('lst')
    .updateMask(clear);
}

function summerMedian(years) {
  return landsat
    .filter(ee.Filter.calendarRange(years[0], years[1], 'year'))
    .filter(ee.Filter.calendarRange(6, 8, 'month'))   // June, July, August
    .filter(ee.Filter.lt('CLOUD_COVER', 40))
    .map(surfaceTempC)
    .median()
    .clip(region);
}

// pack degrees C into 1..255 so 0 can mean "no data"
function encode(lst) {
  return lst.unitScale(MIN_C, MAX_C).clamp(0, 1)
    .multiply(254).add(1).round().toByte()
    .unmask(0);
}

var early = summerMedian(EARLY);
var late = summerMedian(LATE);

// quick look on the map
var vis = { min: 25, max: 50, palette: ['8a5cff', '2f8cff', '00d1c1', '2fd36b', 'c6f432', 'ffd400', 'ff7a1a', 'ff3d9a'] };
Map.centerObject(region, 12);
Map.addLayer(early, vis, 'Summer surface temp ' + EARLY.join('-'));
Map.addLayer(late, vis, 'Summer surface temp ' + LATE.join('-'));
Map.addLayer(late.subtract(early), { min: -6, max: 6, palette: ['2f8cff', '00d1c1', '20202a', 'ff7a1a', 'ff3d9a'] }, 'Change', false);

// download links (grayscale PNG, plain lat/lon grid so it lines up with the web map)
function link(img, name) {
  var url = encode(img).getThumbURL({
    region: region,
    dimensions: WIDTH,
    crs: 'EPSG:4326',
    format: 'png',
    min: 0, max: 255
  });
  print(name + ' (right-click, Save link as... ' + name + ')', url);
}
link(early, 'lst_early.png');
link(late, 'lst_late.png');

// how many clear scenes went into each one (more = more trustworthy)
print('Scenes used, early:', landsat.filter(ee.Filter.calendarRange(EARLY[0], EARLY[1], 'year'))
  .filter(ee.Filter.calendarRange(6, 8, 'month')).filter(ee.Filter.lt('CLOUD_COVER', 40)).size());
print('Scenes used, late:', landsat.filter(ee.Filter.calendarRange(LATE[0], LATE[1], 'year'))
  .filter(ee.Filter.calendarRange(6, 8, 'month')).filter(ee.Filter.lt('CLOUD_COVER', 40)).size());
