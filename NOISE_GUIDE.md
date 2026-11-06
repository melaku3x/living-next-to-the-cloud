# Collecting noise readings

This is the part of the project nobody else has, so it's worth doing right.

## What you need
- A sound meter app that reads in **dBA**. NIOSH SLM (free, iPhone, made by the CDC) is the most trusted one. On Android, "Sound Meter" by Abc Apps works.
- Your phone's location (Google Maps, long-press to drop a pin and copy the coordinates).

## How to take a reading
1. Stand on a public sidewalk or street, never on private property or a data center site.
2. Hold the phone at chest height, mic pointed toward the building, away from your body.
3. Wait for a quiet moment with no cars passing, then record the **average (LAeq)** over 30 seconds. Not the max.
4. Write down the coordinates, the number, the date and time, and where you were.

## Where to go
For each data center you pick, try to get:
- one reading right at the edge of the nearest neighborhood
- one about 500 m away
- one about 1 km away
- a "control" in a quiet neighborhood nowhere near a data center, so there's something to compare to

Nights are the best time. Traffic dies down and the hum is easier to hear. Residents also say it's loudest around 50°F because the fans run harder. If you can, go once on a mild night and once on a cold one.

30 to 50 readings total is plenty.

## Adding them to the map
Open `data/noise.csv` and add one line per reading:

```
lat,lon,dba,datetime,place,note
39.0123,-77.4567,52,2026-11-20 22:15,Edge of Cascades neighborhood,steady hum no traffic
```

Commas inside the note will break it, so put the note in quotes if you need one: `"hum, plus a generator"`.

Save, push to GitHub, refresh the site. The dots show up on the Noise layer, and clicking a data center tells you the average of everything within 1 km.

## Being honest about it
A phone isn't a lab-grade meter, and dBA doesn't really capture the low hum people complain about (the county says this itself). Say that on the site. Your numbers are still real measurements, and the map never shows a reading you didn't take.
