// Living Next to the Cloud: tree loss layer
// Paste this into the Google Earth Engine Code Editor (code.earthengine.google.com) and hit Run.
// It makes one grayscale PNG showing WHEN forest was cleared in eastern Loudoun, 2001 to 2024.
//   tree_loss.png  = each pixel's value is the year it lost its trees (1 = 2001 ... 24 = 2024), 0 = no loss
// The download link shows up in the Console tab on the right. Save it into data/trees/ in the project.
//
// Data: Hansen et al. Global Forest Change v1.12 (University of Maryland, built from Landsat, 30 m pixels)

// ---- settings (bounds match the heat layer so everything lines up) ----
var WEST = -77.62, SOUTH = 38.93, EAST = -77.32, NORTH = 39.10;
var MIN_CANOPY = 30;   // a pixel counts as "forest" in 2000 if at least 30% was covered by trees taller than 5 m
var WIDTH = 1600;      // same output width as the heat PNGs

var region = ee.Geometry.Rectangle([WEST, SOUTH, EAST, NORTH], 'EPSG:4326', false);
var gfc = ee.Image('UMD/hansen/global_forest_change_2024_v1_12').clip(region);

// forest in 2000, and the year it was lost (if it was)
var forest2000 = gfc.select('treecover2000').gte(MIN_CANOPY);
var lossYear = gfc.select('lossyear').updateMask(forest2000).selfMask();   // 1..24, masked where no loss

// quick look on the map
Map.centerObject(region, 12);
Map.addLayer(forest2000.selfMask(), { palette: ['1f6b3a'] }, 'Forest in 2000');
Map.addLayer(lossYear, { min: 1, max: 24, palette: ['ffd400', 'ff7a1a', 'ff3d9a', '8a5cff'] }, 'Year forest was cleared');

// download link (grayscale PNG on a plain lat/lon grid so it lines up with the web map)
var url = lossYear.unmask(0).toByte().getThumbURL({
  region: region,
  dimensions: WIDTH,
  crs: 'EPSG:4326',
  format: 'png',
  min: 0, max: 255     // keeps the raw year codes, so 5 in the PNG really means 2005
});
print('tree_loss.png (right-click, Save link as... tree_loss.png)', url);

// how much forest was cleared each year, in acres (handy for the map's text and for interviews)
var acres = ee.Image.pixelArea().multiply(0.000247105).addBands(gfc.select('lossyear'));
var byYear = acres.updateMask(forest2000.and(gfc.select('lossyear').gt(0))).reduceRegion({
  reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'year' }),
  geometry: region,
  scale: 30,
  maxPixels: 1e9
});
var byYearList = ee.List(byYear.get('groups')).map(function (g) {
  g = ee.Dictionary(g);
  return ee.String(ee.Number(g.get('year')).add(2000).format('%d'))
    .cat(': ').cat(ee.Number(g.get('sum')).round().format('%d')).cat(' acres');
});
print('Acres of forest cleared, by year:', byYearList);

var total = ee.Image.pixelArea().multiply(0.000247105)
  .updateMask(forest2000.and(gfc.select('lossyear').gt(0)))
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: region, scale: 30, maxPixels: 1e9 });
print('Total acres cleared 2001-2024:', total);
