import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

/* -------------------- Global state -------------------- */

let slides, pagerDots, currentSlide = 0;
let typingStarted = new Set();

let modisData = [];
let usTopo = null;
let statesGeo = null;

/** Variables: only NDVI + land surface temperature (day & night) */
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
  }
};

let varStats = {};          // per-variable {min, max, thresholds, colors, scale}

/* Seasonal snapshot controls (Slide 3) */
let currentSeasonVar = "ndvi";
let currentSeasonMonth = 1;
let selectedState = null;   // null => U.S. average

/* % change pre-computation (still used for any other % change views) */
let changeVar = "ndvi";
let percentChangeByVar = {};  // varKey -> Map(stateName -> pctChange)
let changeScales = {};        // varKey -> color scale
let usChangeAverages = {};    // varKey -> U.S. average % change

/* Paris milestones for timeline */
const milestones = [
  { year: 2015, label: "2015: Paris Agreement adopted with U.S. support" },
  { year: 2016, label: "2016: U.S. formally joins the Paris Agreement" },
  { year: 2017, label: "2017: U.S. announces intent to withdraw" },
  { year: 2019, label: "2019: Climate impacts mount while withdrawal looms" },
  { year: 2020, label: "2020: U.S. withdrawal takes legal effect" },
  { year: 2021, label: "2021: U.S. officially rejoins the Paris Agreement" },
  { year: 2025, label: "2025: New executive order on international environmental agreements" }
];

/* Yearly trend controls (Slide 4 – separate from Slide 3) */
const YEARLY_YEARS = d3.range(2014, 2025); // 2014–2024 inclusive
let yearlyVar = "ndvi";     // "ndvi" or "lstDay"
let yearlyState = "";       // "" => U.S. only

let yearlySvg,
  yearlyG,
  xYearScale,
  yYearScale,
  yearlyLineUS,
  yearlyLineState,
  yearlyPointsUS,
  yearlyPointsState;

const yearlyMilestones = [
  { year: 2016, label: "Joins Paris" },
  { year: 2017, label: "Exit announced" },
  { year: 2020, label: "Exit in effect" },
  { year: 2021, label: "Rejoins Paris" }
];

const yearlyExplainers = {
  ndvi: {
    title: "How NDVI (Vegetation Greenness) shifts from 2014–2024",
    body:
      "This chart traces average NDVI (vegetation greenness) over time. The orange line shows the U.S. average; " +
      "when you pick a state, the teal line shows that state. Look for bends around 2016–2017 (joining Paris), " +
      "2017–2020 (exit signaled), and 2020–2021 (exit in effect vs. rejoining) to see whether the state moves " +
      "with or against the national pattern."
  },
  lstDay: {
    title: "How daytime land surface temperatures shift from 2014–2024",
    body:
      "This chart traces average daytime land surface temperature in °F. The orange line shows the U.S. average; " +
      "when you pick a state, the teal line shows that state. Watch how the lines slope before and after the " +
      "Paris Agreement milestones and whether your chosen state is consistently hotter or cooler than the U.S. average."
  }
};

const usParisPhases = [
  {
    start: 2015,
    end: 2017,
    status: "In",
    label: "Joined and ratified",
    color: "#16a34a"
  },
  {
    start: 2017,
    end: 2020,
    status: "In (undermined)",
    label: "Withdrawal announced",
    color: "#fbbf24"
  },
  {
    start: 2020,
    end: 2021,
    status: "Out",
    label: "U.S. formally leaves",
    color: "#f97373"
  },
  {
    start: 2021,
    end: 2025,
    status: "Back in",
    label: "Rejoined Paris",
    color: "#22c55e"
  }
];

/**
 * Narrative content that should show up in the big summary card
 * underneath the timeline.
 */

function setTimelineSummaryDefault() {
  const story = timelineStories.default;
  const titleEl = d3.select("#timelineSummaryTitle");
  const textEl = d3.select("#timelineSummaryText");

  // Overall summary + why it matters when nothing is hovered
  titleEl.text(story.title);
  textEl.text(story.summary);

  // Clear any bullets/links from the last hovered year, so we only see the summary
  const bulletsEl = d3.select("#timelineSummaryBullets");
  if (!bulletsEl.empty()) {
    bulletsEl.html("");
  }
  const linksEl = d3.select("#timelineSummaryLinks");
  if (!linksEl.empty()) {
    linksEl.html("");
  }
}

const timelineStories = {
  default: {
    title: "What Happens Across These Years?",
    summary:
      "From 2015 onward, the Paris Agreement creates a shared framework for limiting warming, " +
      "but U.S. membership shifts several times. In 2015–2016 the U.S. helps negotiate and formally join the Agreement. " +
      "In 2017 the administration announces plans to withdraw, and by 2020 that exit becomes official. " +
      "In 2021 a new administration brings the U.S. back in, and by 2025 U.S. climate policy is again at a crossroads. " +
      "This timeline matters because each turn—signing on, signaling an exit, leaving, and re-entering—sends a powerful signal " +
      "to other countries about how seriously the U.S. treats its climate commitments.",
    bullets: [],
    links: []
  },
  2015: {
    title: "2015: Paris Agreement Adopted",
    summary:
      "In December 2015, nearly every country on Earth agreed to the Paris Climate Agreement, including the United States. The deal set the long-term temperature goals and a process for updating national climate plans.",
    bullets: [
      "195 Parties adopted the Paris Agreement at COP21 in Paris.",
      "The U.S. helped negotiate the deal and signaled support for keeping warming well below 2 °C.",
      "Countries agreed to submit nationally determined contributions (NDCs) and strengthen them over time."
    ],
    links: []
  },
  2016: {
    title: "2016: U.S. Formally Enters the Paris Agreement",
    summary:
      "In 2016, the U.S. formally joined the Paris Agreement, making its commitments official alongside other major emitters like China.",
    bullets: [
      "The U.S. submitted its formal instrument of acceptance and became a Party to the Agreement.",
      "The U.S. NDC pledged to cut emissions 26–28% below 2005 levels by 2025.",
      "The move was framed as a turning point for global climate cooperation."
    ],
    links: [
      {
        label: "Read the 2016 White House blog",
        href: "https://obamawhitehouse.archives.gov/blog/2016/09/03/president-Obama-United-states-formally-enters-Paris-agreement"
      }
    ]
  },
  2017: {
    title: "2017–2019: U.S. Signals an Exit",
    summary:
      "In 2017, the administration announced its intention to withdraw from the Paris Agreement, even though the U.S. had just recently joined.",
    bullets: [
      "The administration argued the pact disadvantaged U.S. workers and the economy.",
      "The U.S. technically remained inside the Agreement until 2020, but the announcement weakened trust.",
      "States, cities, and businesses responded by launching “We Are Still In” and other initiatives to keep cutting emissions."
    ],
    links: [
      {
        label: "2017 State Department statement on withdrawal",
        href: "https://2017-2021.state.gov/on-the-u-s-withdrawal-from-the-paris-agreement/"
      }
    ]
  },
  2019: {
    title: "2019: Climate Impacts During the Paris ‘Limbo’",
    summary:
      "By 2019, the withdrawal process was underway, but the U.S. was still technically in the Agreement while climate impacts kept intensifying.",
    bullets: [
      "Record-breaking heat, wildfires, and hurricanes highlighted the rising costs of delay.",
      "Many U.S. states and cities continued setting their own climate targets.",
      "Internationally, other countries watched to see whether the U.S. would eventually follow through on its exit."
    ],
    links: []
  },
  2020: {
    title: "2020: Withdrawal Takes Effect",
    summary:
      "In November 2020, the U.S. withdrawal from the Paris Agreement became legally effective, just as the world needed stronger climate action.",
    bullets: [
      "The U.S. became the only country to formally leave the Paris Agreement.",
      "The move created uncertainty about long-term U.S. climate commitments.",
      "Global negotiations continued without the U.S. fully at the table."
    ],
    links: [
      {
        label: "State Department statement on withdrawal taking effect",
        href: "https://2017-2021.state.gov/on-the-u-s-withdrawal-from-the-paris-agreement/"
      }
    ]
  },
  2021: {
    title: "2021: U.S. Rejoins the Paris Agreement",
    summary:
      "In early 2021, the U.S. reversed course and rejoined the Paris Agreement, signaling a return to international climate cooperation.",
    bullets: [
      "On the first day in office, the new administration took steps to re-enter the Agreement.",
      "The U.S. formally rejoined in February 2021.",
      "The administration later announced a new 2030 target to cut emissions roughly in half from 2005 levels."
    ],
    links: [
      {
        label: "U.S. announcement about rejoining Paris",
        href: "https://2021-2025.state.gov/the-united-states-officially-rejoins-the-paris-agreement/"
      }
    ]
  },
  2025: {
    title: "2025: Looking Ahead",
    summary:
      "An executive order titled “Putting America First in International Environmental Agreements” (see link) outlines how the administration plans to approach environmental treaties going forward.",
    bullets: [
      "U.S. commitments after 2025 will shape whether the world can still meet the 1.5 °C goal.",
      "Decisions in Washington influence how other countries design their own climate policies.",
      "Scrubbing along this bar is a reminder that international agreements are political stories, not just lines of text."
    ],
    links: [
      {
        label: "2025 executive order on international environmental agreements",
        href: "https://www.whitehouse.gov/presidential-actions/2025/01/putting-america-first-in-international-environmental-agreements/"
      }
    ]
  }
};

/* Shared tooltip */
const tooltip = d3.select("#tooltip");

/* Months for seasonal bar chart (still used for the map month dropdown) */
const monthsSeason = d3.range(1, 13).map((m) => ({
  month: m,
  label: d3.timeFormat("%b")(new Date(2000, m - 1, 1))
}));

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
    if (e.key === "ArrowRight" || e.key === "Enter") {
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

  const els = slide.querySelectorAll(".typewriter");
  if (!els.length) return;

  typingStarted.add(idx);

  const first = els[0];
  const firstFull = first.getAttribute("data-fulltext") || "";
  first.textContent = "";
  let i = 0;

  function typeFirst() {
    if (i <= firstFull.length) {
      first.textContent = firstFull.slice(0, i);
      i += 1;
      setTimeout(typeFirst, 22);
    } else {
      // FIRST done → animate bullets and record duration
      const bulletDuration = animateBulletsOnSlide(slide);

      // SECOND starts AFTER bullets finish
      if (els.length > 1) {
        setTimeout(typeSecond, bulletDuration);
      }
    }
  }

  function typeSecond() {
    const second = els[1];
    const secondFull = second.getAttribute("data-fulltext") || "";
    second.textContent = "";
    let j = 0;

    function tickSecond() {
      if (j <= secondFull.length) {
        second.textContent = secondFull.slice(0, j);
        j += 1;
        setTimeout(tickSecond, 22);
      }
    }

    tickSecond();
  }

  typeFirst();
}



function animateBulletsOnSlide(slide) {
  const bullets = slide.querySelectorAll(".background-bullets li");
  if (!bullets.length) return;

  // ---- STOP ANY PREVIOUS ANIMATION ----
  if (slide._typingTimeout) {
    clearTimeout(slide._typingTimeout);
    slide._typingTimeout = null;
  }

  // ---- STORE FULL TEXT FIRST (IMPORTANT) ----
  bullets.forEach((li) => {
    if (!li.dataset.fulltext) {
      li.dataset.fulltext = li.textContent; 
    }
    li.textContent = "";              // clear after storing
    li.style.visibility = "visible";
  });

  let bulletIndex = 0;
  let charIndex = 0;

  function typeNext() {
    if (bulletIndex >= bullets.length) return;

    const li = bullets[bulletIndex];
    const text = li.dataset.fulltext;

    if (charIndex <= text.length) {
      li.textContent = text.slice(0, charIndex);
      charIndex++;
      slide._typingTimeout = setTimeout(typeNext, 18);
    } else {
      bulletIndex++;
      charIndex = 0;
      slide._typingTimeout = setTimeout(typeNext, 150);
    }
  }

  typeNext();
}


/* -------------------- Data loading & preprocessing -------------------- */

function loadData() {
  return Promise.all([
    d3.csv("data/modis_all_years.csv", (d) => ({
      state: d.NAME,
      year: +d.year,
      month: +d.month,
      NDVI: d.NDVI === "" ? null : +d.NDVI,
      LST_Day: d.LST_Day === "" ? null : +d.LST_Day,
      LST_Night: d.LST_Night === "" ? null : +d.LST_Night,
      date: new Date(d.date)
    })),
    d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json")
  ]).then(([rows, topo]) => {
    modisData = rows;
    usTopo = topo;
    statesGeo = feature(usTopo, usTopo.objects.states).features;

    computeVarStats();
    computeChangeStats();
  });
}

function computeVarStats() {
  Object.entries(VAR_CONFIG).forEach(([key, cfg]) => {
    const vals = modisData
      .map((d) => d[cfg.field])
      .filter((v) => v != null && !Number.isNaN(v));
    const min = d3.min(vals);
    const max = d3.max(vals);

    // 6-bin threshold: 5 internal cut points
    const t = d3.ticks(min, max, 5);
    let colors;
    if (cfg.colorType === "greens") {
      colors = d3.schemeGreens[7].slice(1); // 6 greens
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

/** Precompute percent change 2014 → 2024 for each variable and state. */
function computeChangeStats() {
  percentChangeByVar = {};
  changeScales = {};
  usChangeAverages = {};

  Object.entries(VAR_CONFIG).forEach(([key, cfg]) => {
    const field = cfg.field;

    const baseline = d3.rollup(
      modisData.filter((d) => d.year === 2014),
      (v) => d3.mean(v, (d) => d[field]),
      (d) => d.state
    );
    const latest = d3.rollup(
      modisData.filter((d) => d.year === 2024),
      (v) => d3.mean(v, (d) => d[field]),
      (d) => d.state
    );

    const stateToChange = new Map();
    const allChanges = [];

    statesGeo.forEach((f) => {
      const name = f.properties.name;
      const b = baseline.get(name);
      const l = latest.get(name);
      if (
        b != null &&
        l != null &&
        !Number.isNaN(b) &&
        !Number.isNaN(l) &&
        Math.abs(b) > 1e-6
      ) {
        const pct = ((l - b) / Math.abs(b)) * 100;
        stateToChange.set(name, pct);
        allChanges.push(pct);
      }
    });

    percentChangeByVar[key] = stateToChange;

    const min = d3.min(allChanges);
    const max = d3.max(allChanges);
    const maxAbs = Math.max(Math.abs(min), Math.abs(max)) || 1;

    // Diverging scale: blue (negative) -> white -> red (positive)
    const interpolator = (t) => d3.interpolateRdBu(1 - t); // flip so blue = negative
    const scale = d3
      .scaleDiverging()
      .domain([-maxAbs, 0, maxAbs])
      .interpolator(interpolator);

    changeScales[key] = { scale, maxAbs };

    // U.S. average % change (mean of state averages)
    const bUS = d3.mean(Array.from(baseline.values()).filter((x) => x != null));
    const lUS = d3.mean(Array.from(latest.values()).filter((x) => x != null));
    if (bUS != null && lUS != null && Math.abs(bUS) > 1e-6) {
      usChangeAverages[key] = ((lUS - bUS) / Math.abs(bUS)) * 100;
    } else {
      usChangeAverages[key] = 0;
    }
  });
}

/* -------------------- Seasonal snapshot controls (Slide 3) -------------------- */

function initSeasonControls() {
  const varSelect = document.getElementById("seasonVarSelect");
  const monthSelect = document.getElementById("seasonMonthSelect");

  // Restrict to only NDVI and LST Day for the seasonal (slide 3) chart
  const allowed = ["ndvi", "lstDay"];
  Array.from(varSelect.options).forEach((opt) => {
    if (!allowed.includes(opt.value)) {
      opt.remove();
    }
  });
  if (!allowed.includes(currentSeasonVar)) {
    currentSeasonVar = "ndvi";
  }

  varSelect.value = currentSeasonVar;
  monthSelect.value = String(currentSeasonMonth);

  varSelect.addEventListener("change", () => {
    currentSeasonVar = varSelect.value;
    updateSeasonMap();
    updateSeasonalChart();
  });

  monthSelect.addEventListener("change", () => {
    currentSeasonMonth = +monthSelect.value;
    updateSeasonMap();
    updateSeasonalChart();
  });
}

/* -------------------- Seasonal snapshot map (Slide 3) -------------------- */

let seasonMapSvg, seasonMapG, seasonProjection, seasonPath;

function initSeasonMap() {
  const mapContainer = document.getElementById("seasonMapContainer");
  const { width, height } = mapContainer.getBoundingClientRect();

  seasonMapSvg = d3
    .select("#seasonMapSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  seasonMapG = seasonMapSvg.append("g");

  seasonProjection = d3.geoAlbersUsa().fitSize(
    [width, height],
    {
      type: "FeatureCollection",
      features: statesGeo
    }
  );

  seasonPath = d3.geoPath().projection(seasonProjection);

  seasonMapG
    .selectAll("path.state")
    .data(statesGeo)
    .join("path")
    .attr("class", "state")
    .attr("d", seasonPath)
    .attr("stroke", "#111827")
    .attr("stroke-width", 0.6)
    .attr("fill", "#020617")
    .on("click", (event, d) => {
      selectedState = d.properties.name;
      updateSeasonalChart();
      updateSeasonTitle();

      seasonMapG
        .selectAll("path.state")
        .attr("stroke", (s) =>
          s.properties.name === selectedState ? "#facc15" : "#111827"
        )
        .attr("stroke-width", (s) =>
          s.properties.name === selectedState ? 1.6 : 0.6
        );
      document.getElementById("legendStateLabel").textContent = d.properties.name;
      document.getElementById("legendStateItem").style.display = "flex";
    });

  updateSeasonMap();
}

function updateSeasonMap() {
  const cfg = VAR_CONFIG[currentSeasonVar];
  const stats = varStats[currentSeasonVar];
  if (!cfg || !stats) return;

  // For the selected month, average across all years for each state
  const valuesByState = d3.rollup(
    modisData.filter((d) => d.month === currentSeasonMonth),
    (v) => d3.mean(v, (d) => d[cfg.field]),
    (d) => d.state
  );

  seasonMapG
    .selectAll("path.state")
    .transition()
    .duration(350)
    .attr("fill", (d) => {
      const v = valuesByState.get(d.properties.name);
      if (v == null || Number.isNaN(v)) return "#020617";
      return stats.scale(v);
    });

  drawSeasonLegend();
}

function drawSeasonLegend() {
  const cfg = VAR_CONFIG[currentSeasonVar];
  const stats = varStats[currentSeasonVar];
  const legend = d3.select("#seasonMapLegend");
  legend.html("");

  legend.append("div").text(cfg.legendLabel);

  const row = legend.append("div").attr("class", "map-legend-row");

  const bins = [];
  const thresholds = stats.thresholds;
  const colors = stats.colors;

  const allStops = [stats.min, ...thresholds, stats.max];
  for (let i = 0; i < colors.length; i++) {
    bins.push({
      color: colors[i],
      from: allStops[i],
      to: allStops[i + 1]
    });
  }

  bins.forEach((bin) => {
    const group = row
      .append("div")
      .style("display", "flex")
      .style("flex-direction", "column")
      .style("align-items", "center");

    group
      .append("div")
      .attr("class", "map-legend-swatch")
      .style("background", bin.color);

    group
      .append("div")
      .text(`${bin.from.toFixed(1)}–${bin.to.toFixed(1)}`);
  });
}

/* -------------------- Seasonal chart (Slide 3) – Yearly 2-line chart -------------------- */

let seasonSvg,
  seasonG,
  xSeasonScale,
  ySeasonScale,
  xSeasonAxisG,
  ySeasonAxisG,
  seasonStateLinePath,
  seasonUsLinePath,
  seasonStatePointsGroup,
  seasonUsPointsGroup;

function initSeasonalChart() {
  const container = document.getElementById("seasonBarContainer");
  const { width, height } = container.getBoundingClientRect();

  const margin = { top: 30, right: 40, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  seasonSvg = d3
    .select("#seasonBarSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  seasonG = seasonSvg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  xSeasonScale = d3.scaleLinear().range([0, w]);
  ySeasonScale = d3.scaleLinear().range([h, 0]);

  xSeasonAxisG = seasonG
    .append("g")
    .attr("transform", `translate(0,${h})`);

  ySeasonAxisG = seasonG.append("g");

  // Axis labels
  seasonG
    .append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 32)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Year");

  seasonG
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Value");

  // Lines + points
  seasonStateLinePath = seasonG
    .append("path")
    .attr("fill", "none")
    .attr("stroke", "#38bdf8") // blue: selected state
    .attr("stroke-width", 2);

  seasonUsLinePath = seasonG
    .append("path")
    .attr("fill", "none")
    .attr("stroke", "#f97316") // orange: U.S. avg
    .attr("stroke-width", 2);

  seasonStatePointsGroup = seasonG.append("g");
  seasonUsPointsGroup = seasonG.append("g");

  updateSeasonalChart();
  updateSeasonTitle();
}

/**
 * Build yearly averages for selected state + U.S. for a given variable.
 */
function buildSeasonSeries(stateName, varKey) {
  const cfg = VAR_CONFIG[varKey];
  const field = cfg.field;

  const years = Array.from(
    new Set(modisData.map((d) => d.year))
  ).sort((a, b) => a - b);

  return years.map((year) => {
    const yearData = modisData.filter((d) => d.year === year);

    const usVal = d3.mean(
      yearData
        .map((d) => d[field])
        .filter((v) => v != null && !Number.isNaN(v))
    );

    let stateVal = null;
    if (stateName) {
      const stateYearData = yearData.filter((d) => d.state === stateName);
      stateVal = d3.mean(
        stateYearData
          .map((d) => d[field])
          .filter((v) => v != null && !Number.isNaN(v))
      );
    }

    // If no state is selected, let "state" line follow U.S. average
    if (!stateName) {
      stateVal = usVal;
    }

    return {
      year,
      usValue: usVal,
      stateValue: stateVal
    };
  });
}

function updateSeasonalChart() {
  const series = buildSeasonSeries(selectedState, currentSeasonVar);

  const values = series
    .flatMap((d) => [d.stateValue, d.usValue])
    .filter((v) => v != null && !Number.isNaN(v));

  if (!values.length) return;

  const min = d3.min(values);
  const max = d3.max(values);

  const yearExtent = d3.extent(series, (d) => d.year);

  xSeasonScale.domain(yearExtent);
  ySeasonScale.domain([min, max]).nice();

  const h = ySeasonScale.range()[0];

  // Axes with smooth transitions; ticks at each integer year
  xSeasonAxisG
    .transition()
    .duration(350)
    .call(
      d3
        .axisBottom(xSeasonScale)
        .ticks(series.length)
        .tickFormat(d3.format("d"))
    );

  ySeasonAxisG
    .transition()
    .duration(350)
    .call(d3.axisLeft(ySeasonScale).ticks(6));

  const lineState = d3
    .line()
    .defined((d) => d.stateValue != null && !Number.isNaN(d.stateValue))
    .x((d) => xSeasonScale(d.year))
    .y((d) => ySeasonScale(d.stateValue))
    .curve(d3.curveMonotoneX);

  const lineUs = d3
    .line()
    .defined((d) => d.usValue != null && !Number.isNaN(d.usValue))
    .x((d) => xSeasonScale(d.year))
    .y((d) => ySeasonScale(d.usValue))
    .curve(d3.curveMonotoneX);

  // Animate lines
  seasonStateLinePath
    .datum(series)
    .transition()
    .duration(400)
    .attr("d", lineState);

  seasonUsLinePath
    .datum(series)
    .transition()
    .duration(400)
    .attr("d", lineUs);

  // State points
  const statePts = seasonStatePointsGroup
    .selectAll("circle")
    .data(
      series.filter(
        (d) => d.stateValue != null && !Number.isNaN(d.stateValue)
      ),
      (d) => d.year
    );

  statePts
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("r", 3)
          .attr("fill", "#38bdf8")
          .attr("cx", (d) => xSeasonScale(d.year))
          .attr("cy", h)
          .call((enterSel) =>
            enterSel
              .transition()
              .duration(300)
              .attr("cy", (d) => ySeasonScale(d.stateValue))
          ),
      (update) =>
        update.call((updateSel) =>
          updateSel
            .transition()
            .duration(300)
            .attr("cx", (d) => xSeasonScale(d.year))
            .attr("cy", (d) => ySeasonScale(d.stateValue))
        ),
      (exit) =>
        exit
          .transition()
          .duration(200)
          .attr("cy", h)
          .remove()
    )
    .on("mouseenter", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(
          `Year: ${d.year}<br>` +
            `State: ${d.stateValue.toFixed(3)}<br>` +
            `U.S. avg: ${d.usValue != null ? d.usValue.toFixed(3) : "N/A"}`
        )
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY + 12 + "px");
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
    });

  // U.S. points
  const usPts = seasonUsPointsGroup
    .selectAll("circle")
    .data(
      series.filter((d) => d.usValue != null && !Number.isNaN(d.usValue)),
      (d) => d.year
    );

  usPts
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("r", 3)
          .attr("fill", "#f97316")
          .attr("cx", (d) => xSeasonScale(d.year))
          .attr("cy", h)
          .call((enterSel) =>
            enterSel
              .transition()
              .duration(300)
              .attr("cy", (d) => ySeasonScale(d.usValue))
          ),
      (update) =>
        update.call((updateSel) =>
          updateSel
            .transition()
            .duration(300)
            .attr("cx", (d) => xSeasonScale(d.year))
            .attr("cy", (d) => ySeasonScale(d.usValue))
        ),
      (exit) =>
        exit
          .transition()
          .duration(200)
          .attr("cy", h)
          .remove()
    )
    .on("mouseenter", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(`Year: ${d.year}<br>U.S. avg: ${d.usValue.toFixed(3)}`)
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY + 12 + "px");
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
    });

  updateSeasonTitle();
}

function updateSeasonTitle() {
  const cfg = VAR_CONFIG[currentSeasonVar];
  const title = document.getElementById("seasonTitle");
  const subtitle = document.getElementById("seasonSubtitle");

  const prefix = selectedState
    ? `${selectedState}: Yearly Pattern`
    : "U.S. Average Yearly Pattern";

  title.textContent = prefix;
  subtitle.textContent = `${cfg.label} averaged by year. `;
}

/* -------------------- Yearly trend visualization (Slide 4 – stacked view) -------------------- */

/** Build yearly averages for U.S. and an optional state (independent of Slide 3). */
function buildYearlySeries(varKey, stateName) {
  const field = VAR_CONFIG[varKey].field;

  return YEARLY_YEARS.map((year) => {
    const yearRows = modisData.filter((d) => d.year === year);

    const usVal = d3.mean(
      yearRows
        .map((d) => d[field])
        .filter((v) => v != null && !Number.isNaN(v))
    );

    let stateVal = null;
    if (stateName) {
      const stateRows = yearRows.filter((d) => d.state === stateName);
      stateVal = d3.mean(
        stateRows
          .map((d) => d[field])
          .filter((v) => v != null && !Number.isNaN(v))
      );
    }

    return { year, usVal, stateVal };
  }).filter((d) => d.usVal != null && !Number.isNaN(d.usVal));
}

function updateYearlyExplanation() {
  const expl = yearlyExplainers[yearlyVar] || yearlyExplainers.ndvi;
  const titleEl = document.getElementById("yearlyExplTitle");
  const bodyEl = document.getElementById("yearlyExplBody");
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = expl.title;

  let suffix = "";
  if (yearlyState) {
    suffix =
      " You’re currently comparing " +
      yearlyState +
      " (teal line) against the U.S. average (orange line).";
  } else {
    suffix =
      " You’re currently seeing only the U.S. average. Pick a state to add a comparison line.";
  }

  bodyEl.textContent = expl.body + suffix;
}
function updateYearlyLegend() {
  const legend = document.getElementById("yearlyStateLegend");
  const label = document.getElementById("yearlyStateLegendLabel");

  if (!yearlyState || yearlyState === "") {
    legend.style.display = "none";
  } else {
    legend.style.display = "flex";
    label.textContent = yearlyState;
  }
}

function initYearlyTrend() {
  const varSelect = document.getElementById("yearlyVarSelect");
  const stateSelect = document.getElementById("yearlyStateSelect");
  const container = document.getElementById("yearlyTrendContainer");
  const svgEl = document.getElementById("yearlyTrendSvg");

  if (!varSelect || !stateSelect || !container || !svgEl) {
    return; // slide not present
  }

  // Populate state dropdown from data
  const stateNames = Array.from(new Set(modisData.map((d) => d.state))).sort();
  stateSelect.innerHTML = "";

  const usOnlyOpt = document.createElement("option");
  usOnlyOpt.value = "";
  usOnlyOpt.textContent = "U.S. average only";
  stateSelect.appendChild(usOnlyOpt);

  stateNames.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    stateSelect.appendChild(opt);
  });

  varSelect.value = yearlyVar;
  stateSelect.value = yearlyState;

  varSelect.addEventListener("change", () => {
    yearlyVar = varSelect.value;
    updateYearlyTrend();
    updateYearlyExplanation();
    updateYearlyLegend(); 
  });

  stateSelect.addEventListener("change", () => {
    yearlyState = stateSelect.value;
    updateYearlyTrend();
    updateYearlyExplanation();
    updateYearlyLegend(); 
  });

  // --- Build chart ---
  const { width, height } = container.getBoundingClientRect();
  const margin = { top: 32, right: 32, bottom: 40, left: 60 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  yearlySvg = d3
    .select("#yearlyTrendSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  yearlyG = yearlySvg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  xYearScale = d3
    .scaleLinear()
    .domain(d3.extent(YEARLY_YEARS))
    .range([0, w]);

  yYearScale = d3.scaleLinear().range([h, 0]);

  // axes groups
  yearlyG
    .append("g")
    .attr("class", "x-axis-yearly")
    .attr("transform", `translate(0,${h})`);

  yearlyG.append("g").attr("class", "y-axis-yearly");

  // axis labels
  yearlyG
    .append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 32)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Year");

  yearlyG
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Value");

  // milestone dashed lines
  yearlyG
    .selectAll(".yearly-milestone-line")
    .data(yearlyMilestones)
    .join("line")
    .attr("class", "yearly-milestone-line")
    .attr("x1", (d) => xYearScale(d.year))
    .attr("x2", (d) => xYearScale(d.year))
    .attr("y1", 0)
    .attr("y2", h)
    .on("mouseenter", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(`${d.year}: ${d.label}`)
        .style("left", event.pageX + 12 + "px")
        .style("top", event.pageY + 12 + "px");
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
    });

  yearlyG
    .selectAll(".yearly-milestone-label")
    .data(yearlyMilestones)
    .join("text")
    .attr("class", "yearly-milestone-label")
    .attr("x", (d) => xYearScale(d.year))
    .attr("y", -8)
    .text((d) => d.label);

  yearlyLineUS = yearlyG.append("path").attr("class", "yearly-line-us");
  yearlyLineState = yearlyG.append("path").attr("class", "yearly-line-state");

  yearlyPointsUS = yearlyG.append("g").attr("class", "yearly-points-us");
  yearlyPointsState = yearlyG.append("g").attr("class", "yearly-points-state");

  // overlay for easier hover
  yearlyG
    .append("rect")
    .attr("class", "yearly-hover-rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", w)
    .attr("height", h)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);
      const year = Math.round(xYearScale.invert(mx));
      showYearTooltip(year, event.pageX, event.pageY);
    })
    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
    });

  updateYearlyTrend(true); // first render with animation
  updateYearlyExplanation();
}

function updateYearlyTrend(initial = false) {
  const series = buildYearlySeries(yearlyVar, yearlyState);
  if (!series.length) return;

  const allVals = series
    .flatMap((d) => [
      d.usVal,
      d.stateVal != null ? d.stateVal : null
    ])
    .filter((v) => v != null && !Number.isNaN(v));

  const min = d3.min(allVals);
  const max = d3.max(allVals);
  yYearScale.domain([min, max]).nice();

  const h = yYearScale.range()[0];

  const xAxis = d3
    .axisBottom(xYearScale)
    .ticks(YEARLY_YEARS.length)
    .tickFormat(d3.format("d"));

  const yAxis = d3.axisLeft(yYearScale).ticks(6);

  yearlyG.select(".x-axis-yearly").call(xAxis);
  yearlyG.select(".y-axis-yearly").call(yAxis);

  const lineUS = d3
    .line()
    .x((d) => xYearScale(d.year))
    .y((d) => yYearScale(d.usVal))
    .curve(d3.curveMonotoneX);

  const lineState = d3
    .line()
    .x((d) => xYearScale(d.year))
    .y((d) => yYearScale(d.stateVal))
    .curve(d3.curveMonotoneX);

  // U.S. line
  yearlyLineUS
    .datum(series)
    .classed("yearly-line-us", true)
    .transition()
    .duration(initial ? 800 : 500)
    .attr("d", lineUS);

  // State line (hide if no state selected)
  if (yearlyState) {
    yearlyLineState
      .datum(series.filter((d) => d.stateVal != null))
      .classed("yearly-line-state", true)
      .transition()
      .duration(initial ? 800 : 500)
      .attr("opacity", 1)
      .attr("d", lineState);
  } else {
    yearlyLineState.transition().duration(300).attr("opacity", 0);
  }

  // Points for tooltips
  const usPts = yearlyPointsUS
    .selectAll("circle")
    .data(series, (d) => d.year);

  usPts
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("class", "yearly-point-us")
          .attr("r", 3)
          .attr("cx", (d) => xYearScale(d.year))
          .attr("cy", h),
      (update) => update,
      (exit) => exit.remove()
    )
    .transition()
    .duration(500)
    .attr("cx", (d) => xYearScale(d.year))
    .attr("cy", (d) => yYearScale(d.usVal));

  const stPts = yearlyPointsState
    .selectAll("circle")
    .data(
      series.filter((d) => d.stateVal != null && yearlyState),
      (d) => d.year
    );

  stPts
    .join(
      (enter) =>
        enter
          .append("circle")
          .attr("class", "yearly-point-state")
          .attr("r", 3)
          .attr("cx", (d) => xYearScale(d.year))
          .attr("cy", h),
      (update) => update,
      (exit) => exit.remove()
    )
    .transition()
    .duration(500)
    .attr("cx", (d) => xYearScale(d.year))
    .attr("cy", (d) => yYearScale(d.stateVal));
}

/* Tooltip helper for slide 4 */
function showYearTooltip(year, pageX, pageY) {
  const series = buildYearlySeries(yearlyVar, yearlyState);
  const row = series.find((d) => d.year === year);
  if (!row) return;

  let html = `<strong>${year}</strong><br>U.S. avg: ${row.usVal.toFixed(3)}`;
  if (yearlyState && row.stateVal != null) {
    html += `<br>${yearlyState}: ${row.stateVal.toFixed(3)}`;
  }

  tooltip
    .style("opacity", 1)
    .html(html)
    .style("left", pageX + 12 + "px")
    .style("top", pageY + 12 + "px");
}

/* -------------------- Timeline visualization -------------------- */

/** Choose the story to show for a given year. */
function getStoryForYear(year) {
  const keys = Object.keys(timelineStories)
    .filter((k) => k !== "default")
    .map((k) => +k)
    .sort((a, b) => a - b);

  if (!keys.length) {
    return timelineStories.default;
  }

  let chosen = keys[0];
  for (const k of keys) {
    if (year >= k) {
      chosen = k;
    } else {
      break;
    }
  }
  return timelineStories[chosen] || timelineStories.default;
}

function updateTimelineSummary(year) {
  const story = getStoryForYear(year);
  const titleEl = document.getElementById("timelineSummaryTitle");
  const textEl = document.getElementById("timelineSummaryText");
  const linksEl = document.getElementById("timelineSummaryLinks");

  if (!titleEl || !textEl || !linksEl) return;

  titleEl.textContent = story.title;

  let html = "";
  if (story.summary) {
    html += `<p>${story.summary}</p>`;
  }
  if (story.bullets && story.bullets.length) {
    html += "<ul>";
    for (const b of story.bullets) {
      html += `<li>${b}</li>`;
    }
    html += "</ul>";
  }
  textEl.innerHTML = html;

  linksEl.innerHTML = "";
  if (story.links && story.links.length) {
    story.links.forEach((lnk) => {
      const a = document.createElement("a");
      a.href = lnk.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = lnk.label;
      a.className = "timeline-link-btn";
      linksEl.appendChild(a);
    });
  }
}

function initTimeline() {
  const container = document.getElementById("timelineContainer");
  const { width, height } = container.getBoundingClientRect();
  let activeClickedYear = null;
  let hoveringDot = false;
  const margin = { top: 40, right: 40, bottom: 40, left: 40 };
  const w = width - margin.left - margin.right;
  const h = height - margin.top - margin.bottom;

  const svg = d3
    .select("#timelineSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleLinear()
    .domain([2015, 2025])
    .range([0, w]);

  const centerY = h / 2;

  // base line
  g.append("line")
    .attr("x1", x(2015))
    .attr("x2", x(2025))
    .attr("y1", centerY)
    .attr("y2", centerY)
    .attr("stroke", "#6b7280")
    .attr("stroke-width", 2);

  // colored membership phases
  g.selectAll("rect.phase")
    .data(usParisPhases)
    .join("rect")
    .attr("class", "phase")
    .attr("x", (d) => x(d.start))
    .attr("y", centerY - 12)
    .attr("width", (d) => x(d.end) - x(d.start))
    .attr("height", 24)
    .attr("fill", (d) => d.color)
    .attr("opacity", 0.85)
    .on("mouseenter", (event, d) => {
      d3.select("#timelineNote").text(d.label);

      if (activeClickedYear === null) {
        updateTimelineSummary(d.year);
      }
    });

  // milestones as dots
  const dots = g
    .selectAll("circle.milestone")
    .data(milestones)
    .join("circle")
    .attr("class", "milestone timeline-dot")
    .attr("data-year", (d) => d.year)
    .attr("cx", (d) => x(d.year))
    .attr("cy", centerY)
    .attr("r", 6)
    .attr("fill", "#111827")
    .attr("stroke", "#f3f4f6")
    .attr("stroke-width", 2);

  dots
    .on("mouseenter", (event, d) => {
      d3.select(event.currentTarget)
        .transition()
        .duration(100)
        .attr("r", 8);

      d3.select("#timelineNote").text(d.label);

      if (activeClickedYear === null) {
        updateTimelineSummary(d.year);
      }
    })
    .on("mouseleave", (event, d) => {
      if (activeClickedYear !== d.year) {
        d3.select(event.currentTarget)
          .transition()
          .duration(100)
          .attr("r", 6);
      }

      d3.select("#timelineNote").text(
        "2015–2025: Move along the bar to explore how U.S. membership has changed."
      );

      if (activeClickedYear === null) {
        setTimelineSummaryDefault();
      }
    })
    .on("click", (event, d) => {
      const clickedYear = d.year;

      // clicking the same dot cancels selection
      if (activeClickedYear === clickedYear) {
        activeClickedYear = null;

        setTimelineSummaryDefault();

        d3.selectAll(".timeline-dot")
          .attr("r", 6)
          .attr("stroke", "#f3f4f6")
          .attr("stroke-width", 2);

        return;
      }

      activeClickedYear = clickedYear;

      updateTimelineSummary(clickedYear);

      d3.selectAll(".timeline-dot")
        .attr("r", 6)
        .attr("stroke", "#f3f4f6")
        .attr("stroke-width", 2);

      d3.select(event.currentTarget)
        .attr("r", 10)
        .attr("stroke", "#ffd500")
        .attr("stroke-width", 4);
    });

  // labels
  g
    .selectAll("text.milestone-label")
    .data(milestones)
    .join("text")
    .attr("class", "milestone-label")
    .attr("x", (d) => x(d.year))
    .attr("y", centerY - 22)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 13)
    .attr("font-weight", "600")
    .text((d) => d.year);

  // --- SCRUBBABLE INTERACTION ---
  const hoverLine = g
    .append("line")
    .attr("id", "timelineHoverLine")
    .attr("y1", centerY - 18)
    .attr("y2", centerY + 18)
    .attr("stroke", "#e5e7eb")
    .attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "4,4")
    .style("opacity", 0);

  const activeYearLabel = g
    .append("text")
    .attr("id", "timelineActiveYear")
    .attr("y", centerY + 40)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 12)
    .style("opacity", 0);

  const scrubZone = g.append("rect")
    .attr("class", "timeline-hover-zone")
    .attr("x", x(2015))
    .attr("y", centerY - 30)
    .attr("width", x(2025) - x(2015))
    .attr("height", 60)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);

      let year = Math.round(x.invert(mx));
      year = Math.max(2015, Math.min(2025, year));

      hoverLine
        .attr("x1", x(year))
        .attr("x2", x(year))
        .style("opacity", 1);

      activeYearLabel
        .attr("x", x(year))
        .text(year)
        .style("opacity", 1);

      if (activeClickedYear === null) {
        updateTimelineSummary(year);
      }

      const phase = usParisPhases.find(
        (p) => year >= p.start && year < p.end
      );

      if (phase) {
        d3.select("#timelineNote").text(
          `${year}: ${phase.label} (${phase.status})`
        );
      } else {
        d3.select("#timelineNote").text(
          "Move along the bar to scrub through time."
        );
      }
    })
    .on("mouseleave", () => {
      hoverLine.style("opacity", 0);
      activeYearLabel.style("opacity", 0);

      if (activeClickedYear === null) {
        setTimelineSummaryDefault();
        d3.select("#timelineNote").text(
          "2015–2025: Move along the bar to explore how U.S. membership has changed."
        );
      }
    });

  // move scrub rect behind dots so dots still get mouse events
  scrubZone.lower();

  // initial
  setTimelineSummaryDefault();
}


/* -------------------- Slide 5: Emissions projection play area -------------------- */

/**
 * Approximate GHG emissions (GtCO₂e) for illustration.
 * (Rough, stylized values; the point is the ML concept, not exact numbers.)
 */
const EMISSIONS_DATA = [
  { year: 2010, value: 49.2 },
  { year: 2011, value: 50.1 },
  { year: 2012, value: 51.0 },
  { year: 2013, value: 51.7 },
  { year: 2014, value: 52.1 },
  { year: 2015, value: 52.7 },
  { year: 2016, value: 53.4 },
  { year: 2017, value: 54.3 },
  { year: 2018, value: 55.1 },
  { year: 2019, value: 55.9 },   // reference year for -43% target
  { year: 2020, value: 54.7 },
  { year: 2021, value: 56.0 },
  { year: 2022, value: 57.0 },
  { year: 2023, value: 57.5 },
  { year: 2024, value: 57.8 }
];

const PROJECTION_YEARS = d3.range(2010, 2031); // 2010–2030

let projectionSvg, projectionG;
let xProjScale, yProjScale;
let projActualPath, projModelPath, projTargetPath;
let projActualPoints, projModelPoints;
let projYearLine;
let projMargin = null;     // we’ll use this to place the tooltip correctly

let fittedModel = null;    // {intercept, slope}

/** Ordinary least squares linear regression: y = a + b * year */
function fitLinearRegression(data) {
  const xs = data.map(d => d.year);
  const ys = data.map(d => d.value);
  const n = xs.length;

  const meanX = d3.mean(xs);
  const meanY = d3.mean(ys);

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    num += dx * (ys[i] - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

/** Evaluate the current model at a given year. */
function predictEmission(year) {
  if (!fittedModel) return null;
  return fittedModel.intercept + fittedModel.slope * year;
}

/** Build model projection series 2010–2030 (actual up to 2024, then predicted). */
function buildModelSeries() {
  return PROJECTION_YEARS.map(year => {
    const actual = EMISSIONS_DATA.find(d => d.year === year);
    const value = (year <= 2024 && actual)
      ? actual.value
      : predictEmission(year);
    return { year, value, isActual: year <= 2024 && !!actual };
  }).filter(d => d.value != null && !Number.isNaN(d.value));
}

/**
 * Paris-aligned “on-track” path: peak by 2025, then ~43% below 2019 by 2030.
 * We keep emissions flat at 2019 level through 2025, then drop linearly to
 * 0.57 * 2019 value by 2030.
 */
function buildTargetSeries() {
  const ref2019 = EMISSIONS_DATA.find(d => d.year === 2019).value;
  const peak = ref2019;              // flat peak 2019–2025
  const target2030 = ref2019 * 0.57; // 43% reduction

  const years = d3.range(2019, 2031);
  return years.map(year => {
    let value;
    if (year <= 2025) {
      value = peak;
    } else {
      const t = (year - 2025) / (2030 - 2025); // 0 at 2025, 1 at 2030
      value = peak + t * (target2030 - peak);
    }
    return { year, value };
  });
}

function initProjectionSlide() {
  const container   = document.getElementById("projectionContainer");
  const svgEl       = document.getElementById("projectionSvg");
  const modelSelect = document.getElementById("projectionModelSelect");
  const yearSlider  = document.getElementById("projectionYearSlider");

  if (!container || !svgEl || !modelSelect || !yearSlider) return;

  // --- 1) fit initial "business-as-usual" model (linear regression) ---
  fittedModel = fitLinearRegression(EMISSIONS_DATA);

  const { width, height } = container.getBoundingClientRect();
  const margin = { top: 30, right: 40, bottom: 60, left: 68 };
  projMargin = margin;   // store globally for tooltip placement

  const w = width  - margin.left - margin.right;
  const h = height - margin.top  - margin.bottom;

  projectionSvg = d3
    .select("#projectionSvg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  projectionG = projectionSvg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  xProjScale = d3
    .scaleLinear()
    .domain(d3.extent(PROJECTION_YEARS))
    .range([0, w]);

  // y range based on actual + model + target
  const modelSeriesAll = buildModelSeries();
  const targetSeries   = buildTargetSeries();
  const allVals = modelSeriesAll
    .map(d => d.value)
    .concat(targetSeries.map(d => d.value));

  yProjScale = d3
    .scaleLinear()
    .domain([d3.min(allVals) * 0.97, d3.max(allVals) * 1.03])
    .range([h, 0]);

  // axes
  projectionG
    .append("g")
    .attr("class", "projection-x-axis")
    .attr("transform", `translate(0,${h})`)
    .call(
      d3.axisBottom(xProjScale)
        .ticks(PROJECTION_YEARS.length)
        .tickFormat(d3.format("d"))
    );

  projectionG
    .append("g")
    .attr("class", "projection-y-axis")
    .call(d3.axisLeft(yProjScale).ticks(6));

  // axis labels
  projectionG.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 32)
    .attr("text-anchor", "middle")
    .attr("fill", "#ffffffff")
    .attr("font-size", 11)
    .text("Year");

  projectionG.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -50)
    .attr("text-anchor", "middle")
    .attr("fill", "#e5e7eb")
    .attr("font-size", 11)
    .text("Global greenhouse gas emissions (GtCO₂e)");

  // Paris milestone dashed lines
  const policyYears  = [2015, 2016, 2017, 2020, 2021];
  const policyLabels = {
    2015: "Paris adopted",
    2016: "U.S. joins",
    2017: "Exit announced",
    2020: "Exit in effect",
    2021: "Rejoins"
  };

  projectionG.selectAll(".proj-policy-line")
    .data(policyYears)
    .join("line")
    .attr("class", "proj-policy-line")
    .attr("x1", d => xProjScale(d))
    .attr("x2", d => xProjScale(d))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "#6b7280")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,4")
    .attr("opacity", 0.7);

  projectionG.selectAll(".proj-policy-label")
    .data(policyYears)
    .join("text")
    .attr("class", "proj-policy-label")
    .attr("x", d => xProjScale(d))
    .attr("y", -8)
    .attr("text-anchor", "middle")
    .attr("fill", "#9ca3af")
    .attr("font-size", 10)
    .text(d => policyLabels[d]);

  // lines
  projActualPath = projectionG.append("path")
    .attr("class", "proj-line-actual")
    .attr("fill", "none")
    .attr("stroke", "#f97316")   // orange: historical emissions
    .attr("stroke-width", 2.5);

  projModelPath = projectionG.append("path")
    .attr("class", "proj-line-model")
    .attr("fill", "none")
    .attr("stroke", "#ec4899")   // pink: model projection
    .attr("stroke-width", 2.2)
    .attr("stroke-dasharray", "6,4");

  projTargetPath = projectionG.append("path")
    .attr("class", "proj-line-target")
    .attr("fill", "none")
    .attr("stroke", "#22c55e")   // green: Paris-aligned target path
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "3,3")
    .attr("opacity", 0.9);

  projActualPoints = projectionG.append("g").attr("class", "proj-points-actual");
  projModelPoints  = projectionG.append("g").attr("class", "proj-points-model");

  // vertical year marker
  projYearLine = projectionG.append("line")
    .attr("class", "proj-year-line")
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "#e5e7eb")
    .attr("stroke-width", 1.2)
    .attr("stroke-dasharray", "4,4")
    .attr("opacity", 0);

  // hover rect – drives tooltip on mouse move
  projectionG.append("rect")
    .attr("class", "proj-hover-rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", w)
    .attr("height", h)
    .attr("fill", "transparent")
    .on("mousemove", (event) => {
      const [mx] = d3.pointer(event);
      const year = Math.round(xYearScale.invert(mx));

      // Tooltip
      showYearTooltip(year, event.pageX, event.pageY);

      // 🔥 1. Remove highlight from ALL dots
      svg.selectAll(".timeline-dot")
        .classed("dot-highlight", false)
        .attr("r", 5);

      // 🔥 2. Highlight the selected year’s dot
      svg.selectAll(`.timeline-dot[data-year='${year}']`)
        .classed("dot-highlight", true)
        .attr("r", 9);  // bump size so it visually pops
    })

    .on("mouseleave", () => {
      tooltip.style("opacity", 0);
      projYearLine.attr("opacity", 0);
    });

  // --- model selector: BAU vs hypothetical “on-track” linear path starting 2024 ---
  modelSelect.addEventListener("change", () => {
    const mode = modelSelect.value;

    if (mode === "linear") {
      // Business-as-usual: regression on 2010–2024.
      fittedModel = fitLinearRegression(EMISSIONS_DATA);
    } else if (mode === "faster-cut") {
      // Hypothetical faster cuts: straight line from 2024 actual to 2030 target.
      const ref2019     = EMISSIONS_DATA.find(d => d.year === 2019).value;
      const actual2024  = EMISSIONS_DATA.find(d => d.year === 2024).value;
      const target2030  = ref2019 * 0.57;
      const slope       = (target2030 - actual2024) / (2030 - 2024);
      const intercept   = actual2024 - slope * 2024;
      fittedModel = { intercept, slope };
    }

    updateProjectionChart();
    updateProjectionSummary();
  });

  // slider: focus on 2024–2030 comparison
  yearSlider.min   = 2024;
  yearSlider.max   = 2030;
  yearSlider.value = 2024;
  yearSlider.addEventListener("input", (e) => {
    const y = +e.target.value;
    // Position tooltip above the line even when changing via slider
    updateProjectionYear(y);
  });

  // legend text is static; chart + summary dynamic
  updateProjectionChart(true);
  updateProjectionSummary();

  // initial label only (no tooltip so it doesn't show on other slides)
  const yearLabel = document.getElementById("projectionYearLabel");
  if (yearLabel) {
    yearLabel.textContent = "Focus year: 2030";
  }
}

function updateProjectionChart(animate = false) {
  const modelSeries  = buildModelSeries();
  const targetSeries = buildTargetSeries();

  const lineActual = d3.line()
    .x(d => xProjScale(d.year))
    .y(d => yProjScale(d.value))
    .curve(d3.curveMonotoneX);

  const lineModel = d3.line()
    .x(d => xProjScale(d.year))
    .y(d => yProjScale(d.value))
    .curve(d3.curveMonotoneX);

  const lineTarget = d3.line()
    .x(d => xProjScale(d.year))
    .y(d => yProjScale(d.value))
    .curve(d3.curveMonotoneX);

  const actualSeries = modelSeries.filter(d => d.year <= 2024);
  const modelFuture  = modelSeries.filter(d => d.year >= 2024);

  const dur = animate ? 900 : 450;

  projActualPath
    .datum(actualSeries)
    .transition()
    .duration(dur)
    .attr("d", lineActual);

  projModelPath
    .datum(modelFuture)
    .transition()
    .duration(dur)
    .attr("d", lineModel);

  projTargetPath
    .datum(targetSeries)
    .transition()
    .duration(dur)
    .attr("d", lineTarget);

  // points
  const actualPts = projActualPoints
    .selectAll("circle")
    .data(actualSeries, d => d.year);

  actualPts.join(
  enter => enter.append("circle")
    .attr("r", 3)
    .attr("fill", "#f97316")
    .attr("class", "projection-dot")
    .attr("data-year", d => d.year)
    .attr("cx", d => xProjScale(d.year))
    .attr("cy", d => yProjScale(d.value)),
  update => update,
  exit => exit.remove()
);


  const modelPts = projModelPoints
  .selectAll("circle")
  .data(modelFuture, d => d.year);

modelPts.join(
  enter => enter.append("circle")
    .attr("r", 3)
    .attr("fill", "#ec4899")
    .attr("cx", d => xProjScale(d.year))
    .attr("cy", d => yProjScale(d.value)),
  update => update
    .transition()
    .duration(dur)
    .attr("cx", d => xProjScale(d.year))
    .attr("cy", d => yProjScale(d.value)),
  exit => exit.remove()
);
}

/** Update the text explanation (high-level DS / ML narrative). */
function updateProjectionSummary() {
  const titleEl = document.getElementById("projectionExplTitle");
  const bodyEl  = document.getElementById("projectionExplBody");
  if (!titleEl || !bodyEl) return;

  const mode = document.getElementById("projectionModelSelect")?.value || "linear";

  titleEl.textContent = "Are We On Track for 2030?";

  const ref2019    = EMISSIONS_DATA.find(d => d.year === 2019).value;
  const actual2024 = EMISSIONS_DATA.find(d => d.year === 2024).value;
  const model2030  = predictEmission(2030);
  const target2030 = ref2019 * 0.57;

  const changeSince2019   = ((actual2024 - ref2019) / ref2019) * 100;
  const neededDropFrom2024 =
    ((target2030 - actual2024) / actual2024) * 100;
  const overshootVsTarget =
    ((model2030 - target2030) / target2030) * 100;

  const modelText =
    mode === "linear"
      ? "a simple linear regression model trained on 2010–2024 emissions to project a “business-as-usual” path (pink dashed line)"
      : "a hypothetical linear path that starts at the 2024 value and slopes down just enough to hit the 43%-below-2019 target in 2030 (pink dashed line)";

  bodyEl.textContent =
    "This play area uses " + modelText + ". The green dashed line shows a Paris-aligned pathway that keeps " +
    "emissions roughly flat through 2025 and then cuts them about 43% below 2019 levels by 2030. " +
    `In this stylized data, emissions in 2024 are about ${changeSince2019.toFixed(
      1
    )}% above 2019. To hit the 2030 target from that level, emissions would need to fall about ${Math.abs(
      neededDropFrom2024
    ).toFixed(
      1
    )}% between 2024 and 2030. With the current model choice, the 2030 projection is about ${overshootVsTarget.toFixed(
      1
    )}% above the Paris-aligned target, highlighting how much steeper cuts would need to be.`;
}

/** Highlight a specific year and show values + % differences. */
function updateProjectionYear(year, pageX, pageY) {
  const yearClamped = Math.max(2010, Math.min(2030, year));
  const actual      = EMISSIONS_DATA.find(d => d.year === yearClamped);
  const modelVal    = predictEmission(yearClamped);

  const ref2019   = EMISSIONS_DATA.find(d => d.year === 2019).value;
  const targetRow = buildTargetSeries().find(d => d.year === yearClamped);
  const targetVal = targetRow ? targetRow.value : null;

  projYearLine
    .attr("x1", xProjScale(yearClamped))
    .attr("x2", xProjScale(yearClamped))
    .attr("opacity", 1);

  const parts = [`<strong>${yearClamped}</strong>`];

  if (actual) {
    parts.push(`Actual: ${actual.value.toFixed(1)} GtCO\u2082e`);
  } else {
    parts.push("Actual: —");
  }

  if (modelVal != null) {
    parts.push(`Model: ${modelVal.toFixed(1)} GtCO\u2082e`);
  }

  if (targetVal != null) {
    parts.push(`Paris-aligned: ${targetVal.toFixed(1)} GtCO\u2082e`);
    const gap = modelVal != null ? ((modelVal - targetVal) / targetVal) * 100 : null;
    if (gap != null && yearClamped >= 2025) {
      parts.push(
        `Model is about ${gap.toFixed(1)}% ${gap > 0 ? "above" : "below"} the Paris-aligned path.`
      );
    }
  }

  // Figure out where to put the tooltip:
  //  - if we got pageX/pageY (mouse move), use those
  //  - otherwise, anchor it above the selected year on the chart (for slider use)
  let xScreen = pageX;
  let yScreen = pageY;

  if (!xScreen || !yScreen) {
    const svgRect = projectionSvg.node().getBoundingClientRect();
    xScreen = svgRect.left + projMargin.left + xProjScale(yearClamped);
    yScreen = svgRect.top  + projMargin.top  + 10;
  }

  tooltip
    .style("opacity", 1)
    .html(parts.join("<br>"))
    .style("left", (xScreen + 12) + "px")
    .style("top",  (yScreen + 12) + "px");

  // update “Focus year” label under the slider
  const yearLabel = document.getElementById("projectionYearLabel");
  if (yearLabel) {
    yearLabel.textContent = `Focus year: ${yearClamped}`;
  }
}


/* -------------------- Init -------------------- */

async function init() {
  initSlides();
  await loadData();
  initSeasonControls();
  initSeasonMap();
  initSeasonalChart();   // Slide 3
  initTimeline();        // Timeline slide
  initYearlyTrend();     // Slide 4 stacked yearly view
  initProjectionSlide(); // NEW: Slide 5 play area
}

init();
