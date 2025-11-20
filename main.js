import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

/* -------------------- Global state -------------------- */

let slides, pagerDots, currentSlide = 0;
let typingStarted = new Set();

let modisData = [];
let usTopo = null;
let statesGeo = null;

const VAR_CONFIG = {
  ndvi: {
    field: "NDVI",
    label: "NDVI (Vegetation Greenness)",
    legendLabel: "NDVI (unitless)",
    colorType: "greens"
  },
  lstDay: {
    field: "LST_Day",
    label: "Land Surface Temp – Day (°F)",
    legendLabel: "Land Surface Temperature – Day (°F)",
    colorType: "temp"
  },
  lstNight: {
    field: "LST_Night",
    label: "Land Surface Temp – Night (°F)",
    legendLabel: "Land Surface Temperature – Night (°F)",
    colorType: "temp"
  },
  et: {
    field: "ET",
    label: "Evapotranspiration (mm/day)",
    legendLabel: "Evapotranspiration (mm/day)",
    colorType: "blues"
  }
};

let varStats = {};   // per-variable {min, max, thresholds, colors}
let currentVar = "ndvi";
let currentYear = 2014;
let currentMonth = 1;
let selectedState = null; // null => U.S. average

// Paris Agreement milestones
const milestones = [
  { year: 2015, label: "Paris adopted (2015)" },
  { year: 2016, label: "In force (2016)" },
  { year: 2017, label: "Withdrawal announced (2017)" },
  { year: 2020, label: "Withdrawal effective (2020)" },
  { year: 2021, label: "U.S. rejoins (2021)" }
];

/* -------------------- Slide nav + typewriter -------------------- */

function initSlides() {
  slides = Array.from(document.querySelectorAll(".slide"));
  const pager = document.getElementById("pager");
  pager.innerHTML = "";
  slides.forEach((_, idx) => {
    const dot = document.createElement("div");
    dot.className = "pager-dot" + (idx === 0 ? " active" : "");
    dot.dataset.index = idx;
    dot.addEventListener("click", () => goToSlide(idx));
    pager.appendChild(dot);
  });
  pagerDots = Array.from(document.querySelectorAll(".pager-dot"));

  document.getElementById("prevSlide").addEventListener("click", () => {
    goToSlide((currentSlide - 1 + slides.length) % slides.length);
  });
  document.getElementById("nextSlide").addEventListener("click", () => {
    goToSlide((currentSlide + 1) % slides.length);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      goToSlide((currentSlide + 1) % slides.length);
    } else if (e.key === "ArrowLeft") {
      goToSlide((currentSlide - 1 + slides.length) % slides.length);
    }
  });

  startTypewriterOnSlide(currentSlide);
}

function goToSlide(idx) {
  slides[currentSlide].classList.remove("active");
  pagerDots[currentSlide].classList.remove("active");
  currentSlide = idx;
  slides[currentSlide].classList.add("active");
  pagerDots[currentSlide].classList.add("active");
  startTypewriterOnSlide(currentSlide);
}

function startTypewriterOnSlide(idx) {
  const slide = slides[idx];
  if (!slide.classList.contains("type-slide")) return;
  if (typingStarted.has(idx)) return;

  const el = slide.querySelector(".typewriter");
  if (!el) return;
  typingStarted.add(idx);

  const full = el.getAttribute("data-fulltext") || "";
  el.textContent = "";
  let i = 0;

  function tick() {
    if (i <= full.length) {
      el.textContent = full.slice(0, i);
      i += 1;
      setTimeout(tick, 22);
    }
  }
  tick();
}

/* -------------------- Data loading -------------------- */

function loadData() {
  return Promise.all([
    d3.csv("data/modis_all_years.csv", (d) => ({
      state: d.NAME,
      year: +d.year,
      month: +d.month,
      NDVI: d.NDVI === "" ? null : +d.NDVI,
      LST_Day: d.LST_Day === "" ? null : +d.LST_Day,
      LST_Night: d.LST_Night === "" ? null : +d.LST_Night,
      ET: d.ET === "" ? null : +d.ET,
      date: new Date(d.date)
    })),
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
  ]).then(([rows, topo]) => {
    modisData = rows;
    usTopo = topo;
    statesGeo = feature(usTopo, usTopo.objects.states).features;

    computeVarStats();
  });
}

function computeVarStats() {
  Object.entries(VAR_CONFIG).forEach(([key, cfg]) => {
    const vals = modisData
      .map((d) => d[cfg.field])
      .filter((v) => v != null && !Number.isNaN(v));
    const min = d3.min(vals);
    const max = d3.max(vals);

    // 6-bin threshold: we need 5 internal cut points
    const t = d3.ticks(min, max, 5);
    let colors;
    if (cfg.colorType === "greens") {
      colors = d3.schemeGreens[7].slice(1); // 6 greens
    } else if (cfg.colorType === "blues") {
      colors = d3.schemeBlues[7].slice(1); // 6 blues
    } else if (cfg.colorType === "temp") {
      // blue -> light blue -> yellow -> orange -> red
      colors = [
        "#1d4ed8",
        "#2563eb",
        "#38bdf8",
        "#facc15",
        "#fb923c",
        "#ef4444"
      ];
    } else {
      colors = d3.schemeGreys[7].slice(1);
    }

    const scale = d3.scaleThreshold().domain(t).range(colors);
    varStats[key] = { min, max, thresholds: t, colors, scale };
  });
}

/* -------------------- Map + Seasonal chart -------------------- */

function initControls() {
  const varSelect = document.getElementById("varSelect");
  const yearSlider = document.getElementById("yearSlider");
  const yearLabel = document.getElementById("yearLabel");
  const monthSelect = document.getElementById("monthSelect");

  varSelect.value = currentVar;
  yearSlider.value = currentYear;
  yearLabel.textContent = currentYear;
  monthSelect.value = currentMonth;

  varSelect.addEventListener("change", () => {
    currentVar = varSelect.value;
    updateMap();
    updateSeasonalChart();
  });

  yearSlider.addEventListener("input", () => {
    currentYear = +yearSlider.value;
    yearLabel.textContent = currentYear;
    updateMap();
  });

  monthSelect.addEventListener("change", () => {
    currentMonth = +monthSelect.value;
    updateMap();
  });
}

/* --- Map --- */

let mapSvg, mapG, projection, pathGenerator;

function initMap() {
  const mapContainer = document.getElementById("mapContainer");
  const { width, height } = mapContainer.getBoundingClientRect();

  mapSvg = d3.select("#mapSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  mapG = mapSvg.append("g");

  projection = d3.geoAlbersUsa().fitSize([width, height], {
    type: "FeatureCollection",
    features: statesGeo
  });

  pathGenerator = d3.geoPath().projection(projection);

  // Draw base states once
  mapG.selectAll("path.state")
    .data(statesGeo)
    .join("path")
    .attr("class", "state")
    .attr("d", pathGenerator)
    .attr("stroke", "#111827")
    .attr("stroke-width", 0.6)
    .attr("fill", "#020617")
    .on("click", (event, d) => {
      selectedState = d.properties.name;
      updateSeasonalChart();
      updateStateTitle();
      // highlight stroke
      mapG.selectAll("path.state")
        .attr("stroke", (s) =>
          s.properties.name === selectedState ? "#facc15" : "#111827"
        )
        .attr("stroke-width", (s) =>
          s.properties.name === selectedState ? 1.6 : 0.6
        );
    });

  updateMap();
}

function updateMap() {
  const cfg = VAR_CONFIG[currentVar];
  const stats = varStats[currentVar];
  if (!cfg || !stats) return;

  // Filter to current year + month, map by state name
  const valuesByState = d3.rollup(
    modisData.filter(
      (d) => d.year === currentYear && d.month === currentMonth
    ),
    (v) => d3.mean(v, (d) => d[cfg.field]),
    (d) => d.state
  );

  mapG.selectAll("path.state")
    .transition()
    .duration(350)
    .attr("fill", (d) => {
      const v = valuesByState.get(d.properties.name);
      if (v == null || Number.isNaN(v)) return "#020617";
      return stats.scale(v);
    });

  drawMapLegend();
}

function drawMapLegend() {
  const cfg = VAR_CONFIG[currentVar];
  const stats = varStats[currentVar];
  const legend = d3.select("#mapLegend");
  legend.html("");

  const title = legend.append("div").text(cfg.legendLabel);

  const row = legend.append("div").attr("class", "map-legend-row");

  const bins = [];
  const thresholds = stats.thresholds;
  const colors = stats.colors;

  // create [min, t0], (t0,t1], ..., (t_{n-1}, max]
  const allStops = [stats.min, ...thresholds, stats.max];
  for (let i = 0; i < colors.length; i++) {
    bins.push({
      color: colors[i],
      from: allStops[i],
      to: allStops[i + 1]
    });
  }

  bins.forEach((bin) => {
    const group = row.append("div").style("display", "flex").style("flex-direction", "column").style("align-items", "center");

    group.append("div")
      .attr("class", "map-legend-swatch")
      .style("background", bin.color);

    group.append("div")
      .text(
        `${bin.from.toFixed(1)}–${bin.to.toFixed(1)}`
      );
  });
}

/* --- Seasonal line chart --- */

let seasonSvg, seasonG, xScale, yScale, xAxisG, yAxisG;
let linePath, pointsGroup, milestoneGroup;
const tooltip = d3.select("#tooltip");

function initSeasonalChart() {
  const container = document.getElementById("stateSeasonContainer");
  const { width, height } = container.getBoundingClientRect();

  const margin = { top: 40, right: 40, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  seasonSvg = d3.select("#stateSeasonSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  seasonG = seasonSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  xScale = d3.scaleTime()
    .domain(d3.extent(modisData, (d) => d.date))
    .range([0, w]);

  yScale = d3.scaleLinear().range([h, 0]);

  xAxisG = seasonG.append("g")
    .attr("transform", `translate(0,${h})`);

  yAxisG = seasonG.append("g");

  // axis labels
  seasonG.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 32)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Year");

  seasonG.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Value");

  linePath = seasonG.append("path")
    .attr("fill", "none")
    .attr("stroke", "#38bdf8")
    .attr("stroke-width", 2);

  pointsGroup = seasonG.append("g");
  milestoneGroup = seasonG.append("g");

  updateSeasonalChart();
}

function buildSeriesForState(stateName) {
  const cfg = VAR_CONFIG[currentVar];
  const field = cfg.field;

  const filtered = modisData.filter((d) =>
    stateName ? d.state === stateName : true
  );

  // group by date and average across states if needed
  const byDate = d3.rollups(
    filtered,
    (v) => d3.mean(v, (d) => d[field]),
    (d) => +d.date
  ).map(([timeMs, val]) => ({
    date: new Date(+timeMs),
    value: val
  }));

  return byDate
    .filter((d) => d.value != null && !Number.isNaN(d.value))
    .sort((a, b) => a.date - b.date);
}

function updateSeasonalChart() {
  const series = buildSeriesForState(selectedState);
  if (!series.length) return;

  const container = document.getElementById("stateSeasonContainer");
  const { width, height } = container.getBoundingClientRect();
  const margin = { top: 40, right: 40, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  xScale.range([0, w]);
  yScale.range([h, 0]).domain(d3.extent(series, (d) => d.value)).nice();

  xAxisG.attr("transform", `translate(0,${h})`)
    .call(
      d3.axisBottom(xScale)
        .ticks(d3.timeYear.every(1))
        .tickFormat(d3.timeFormat("%Y"))
    );

  yAxisG.call(d3.axisLeft(yScale).ticks(6));

  const line = d3.line()
    .x((d) => xScale(d.date))
    .y((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  linePath
    .datum(series)
    .attr("d", line);

  // points
  const pts = pointsGroup
    .selectAll("circle")
    .data(series);

  pts.join(
    (enter) =>
      enter.append("circle")
        .attr("r", 3)
        .attr("fill", "#38bdf8")
        .attr("cx", (d) => xScale(d.date))
        .attr("cy", (d) => yScale(d.value)),
    (update) =>
      update
        .attr("cx", (d) => xScale(d.date))
        .attr("cy", (d) => yScale(d.value)),
    (exit) => exit.remove()
  )
    .on("mouseenter", (event, d) => {
      const fmtMonth = d3.timeFormat("%b %Y");
      tooltip
        .style("opacity", 1)
        .html(
          `${fmtMonth(d.date)}<br>${d.value.toFixed(3)}`
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY + 12 + "px");
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
    });

  drawMilestones(w, h);
  updateStateTitle();
}

function updateStateTitle() {
  const cfg = VAR_CONFIG[currentVar];
  const title = document.getElementById("stateTitle");
  const subtitle = document.getElementById("stateSubtitle");
  const prefix = selectedState ? `${selectedState}: Seasonal Pattern` : "U.S. Average Seasonal Pattern";

  title.textContent = prefix;
  subtitle.textContent = `${cfg.label} averaged ${
    selectedState ? `across ${selectedState}` : "across all states"
  } (2014–2024). Paris Agreement milestones are shown as red dotted lines.`;
}

function drawMilestones(w, h) {
  const milestoneNote = d3.select("#milestoneNote");

  const lines = milestoneGroup
    .selectAll("line.milestone-line")
    .data(milestones);

  lines.join(
    (enter) =>
      enter.append("line")
        .attr("class", "milestone-line")
        .attr("stroke", "#f97373")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4 4")
        .attr("x1", (d) => xScale(new Date(d.year, 0, 1)))
        .attr("x2", (d) => xScale(new Date(d.year, 0, 1)))
        .attr("y1", 0)
        .attr("y2", h)
        .on("click", (event, d) => {
          milestoneNote.text(d.label);
        }),
    (update) =>
      update
        .attr("x1", (d) => xScale(new Date(d.year, 0, 1)))
        .attr("x2", (d) => xScale(new Date(d.year, 0, 1)))
        .attr("y1", 0)
        .attr("y2", h),
    (exit) => exit.remove()
  );
}

/* -------------------- Init -------------------- */

async function init() {
  initSlides();
  await loadData();
  initControls();
  initMap();
  initSeasonalChart();
}

init();
