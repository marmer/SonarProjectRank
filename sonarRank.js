// ==UserScript==
// @name         Sonar Project Rank
// @namespace    http://tampermonkey.net/
// @version      0.7
// @description  Prints project ranks and improvements based on changes within the last 90 days
// @author       MarMer
// @updateURL    https://raw.githubusercontent.com/marmer/SonarProjectRank/master/sonarRank.js
// @downloadURL  https://raw.githubusercontent.com/marmer/SonarProjectRank/master/sonarRank.js
// @match        https://sonar.prod.ccs.gematik.solutions/**
// @icon         https://sonar.prod.ccs.gematik.solutions/apple-touch-icon.png
// @require      https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js
// @grant        none
// ==/UserScript==

const metrics = [
  "sqale_index",
  "reliability_remediation_effort",
  "security_remediation_effort",
  "security_hotspots",
  "ncloc",
]
const topCount = 10;

function threeMonthAgo() {
  return dateFns.format(dateFns.subDays(new Date(), 90), "YYYY-MM-DD")
}

/**
 * Shuffles array in place. ES6 version. From https://stackoverflow.com/questions/6274339/how-can-i-shuffle-an-array
 * @param {Array} a items An array containing the items.
 */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * DiffEntry
 * @typedef {
 *   {
 *      deltaAbsolute: Number,
 *      oldEntry: {
 *        date: String,
 *        value: Number,
 *      },
 *      newEntry: {
 *        date: String,
 *        value: Number,
 *      }
 *    }
 *  } DiffEntry
 */

/**
 * Diff
 * @typedef {
 *  {
 *    componentKey: String,
 *    componentName: String,
 *    measures: {
 *    sqale_index: DiffEntry,
 *    affordToFixInHoursPer1000Lines: DiffEntry,
 *    reliability_remediation_effort: DiffEntry,
 *    security_remediation_effort: DiffEntry,
 *    security_hotspots: DiffEntry,
 *    ncloc: DiffEntry
 *    }?
 *  }
 * } Diff
 */

/**
 * IncompleteDiff
 * @typedef {
 *  {
 *    componentKey: String,
 *    componentName: String,
 *    measures: {
 *    sqale_index: DiffEntry,
 *    reliability_remediation_effort: DiffEntry,
 *    security_remediation_effort: DiffEntry,
 *    security_hotspots: DiffEntry,
 *    ncloc: DiffEntry
 *    }?
 *  }
 * } IncompleteDiff
 */


function fetchAllComponents() {
  return fetch("/api/components/search?ps=500&qualifiers=APP,TRK")
    .then(response => response.text())
    .then(JSON.parse)
    .then(responseBody => responseBody.components)
}

function fetchMetricsFor(component) {
  return fetch(
    `https://sonar.prod.ccs.gematik.solutions/api/measures/search_history?component=${encodeURIComponent(
      component.key)}&metrics=${metricsUriComponent()}&ps=1000&from=${threeMonthAgo()}`)
    .then(response => response.text())
    .then(JSON.parse);
}

function metricsUriComponent() {
  return encodeURIComponent(metrics.reduce((a, b) => `${a},${b}`));
}

function wasAnalized(metricDiff) {
  return metricDiff?.measures?.sqale_index && metricDiff?.measures?.ncloc;
}

/**
 *
 * @param {IncompleteDiff} metricDiff
 * @returns {Diff | void}
 */
function addAffordToFixInHoursPer1000Loc(metricDiff) {

  if (!wasAnalized(metricDiff)) {
    return
  }

  const oldValuePer1000Loc =
    (
      metricDiff.measures.sqale_index.oldEntry.value
      +
      metricDiff.measures.reliability_remediation_effort.oldEntry.value
      +
      metricDiff.measures.security_remediation_effort.oldEntry.value
      +
      metricDiff.measures.security_hotspots.oldEntry.value * 15 //15 min
    ) /
    metricDiff.measures.ncloc.oldEntry.value * 1000 // per 1000 Lines of Code
    / 60 //hours

  const newValuePer1000Loc =
    (
      metricDiff.measures.sqale_index.newEntry.value
      +
      metricDiff.measures.reliability_remediation_effort.newEntry.value
      +
      metricDiff.measures.security_remediation_effort.newEntry.value
      +
      metricDiff.measures.security_hotspots.newEntry.value * 15
    ) /
    metricDiff.measures.ncloc.newEntry.value * 1000  // per 1000 Lines of Code
    / 60 //hours

  const deltaAbsolutePer1000Loc = newValuePer1000Loc - oldValuePer1000Loc

  metricDiff.measures.affordToFixInHoursPer1000Lines = {
    deltaAbsolute: deltaAbsolutePer1000Loc,
    oldEntry: {
      date: metricDiff
        .measures.sqale_index.oldEntry.date,
      value: oldValuePer1000Loc,
    },
    newEntry: {
      date: metricDiff
        .measures.sqale_index.newEntry.date,
      value: newValuePer1000Loc,
    }
  };
}

/**
 * @param component
 * @param componentMetricResponse
 * @return {Diff}
 */
function toComponentMetricDiff(component, componentMetricResponse) {
  let measures = componentMetricResponse.measures.filter(it => it.history.length).reduce((a, b) => {
    const result = {...a};

    const oldEntry = b.history[0];
    const newEntry = b.history[b.history.length - 1];
    const deltaAbsolute = (newEntry?.value && oldEntry?.value) ?
      newEntry.value - oldEntry.value
      : undefined

    result[b.metric] = {
      oldEntry,
      newEntry,
      deltaAbsolute,
    }
    return result
  }, {});

  const metricDiff = {
    componentKey: component.key,
    componentName: component.name,
    measures
  };

  addAffordToFixInHoursPer1000Loc(metricDiff);

  return metricDiff;
}

/**
 * @param {Diff} diff
 */
function hasTechnicalDept(diff) {
  return diff.measures?.sqale_index?.newEntry?.value;
}

function printRankedDiffEntry(rank, diff, diffEntry) {
  const minimumIntegerDigits = Math.max(diffEntry.newEntry.value.toFixed(0).length,
    diffEntry.oldEntry.value.toFixed(0).length)
  let formatOptions = {
    minimumIntegerDigits,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  };

  console.log(`${rank}: "${diff.componentName}" - "${diff.componentKey}"
\t ${diffEntry.newEntry.value.toLocaleString("de-DE",
    formatOptions)} h/1000LOC - @${diffEntry.newEntry.date.substring(
    0,
    10)} - ${diff.measures.ncloc.newEntry.value.toLocaleString("de-DE")} loc
\t ${diffEntry.oldEntry.value.toLocaleString("de-DE",
    formatOptions)} h/1000LOC - @${diffEntry.oldEntry.date.substring(
    0,
    10)} - ${diff.measures.ncloc.oldEntry.value.toLocaleString("de-DE")} loc
\t${diffEntry.deltaAbsolute < 0 ? "-" : " "}${Math.abs(diffEntry.deltaAbsolute).toLocaleString(
    "de-DE",
    formatOptions)} h/1000LOC - absolute improvement
\t https://sonar.prod.ccs.gematik.solutions/dashboard?id=${diff.componentKey}`);
}

function printRankedDiff(diff, index) {
  const rank = index + 1;
  const diffEntry = diff.measures.affordToFixInHoursPer1000Lines;
  printRankedDiffEntry(rank, diff, diffEntry);
}

/**
 * @param {Diff[]} diffs
 * @param {string} header Description of what to print the top 5 of
 * @param {(Diff) => Number} sortKeyProvider Selector of the key to use for comparison
 */
function showTop5ByKeySelector(diffs, header, sortKeyProvider) {
  console.log(`=== Top ${topCount} ${header} ===`)

  diffs
    .filter(it => hasTechnicalDept(it))
    .sort((a, b) => {
      return sortKeyProvider(a) - sortKeyProvider(b);
    })
    .slice(0, topCount)
    .forEach(printRankedDiff)
}

/**
 * @param {Diff[]} diffs
 */
function showRanks(diffs) {
  console.clear()
  console.log(`This Script shows only Projects with changes since ${threeMonthAgo()}`)
  showTop5ByKeySelector(diffs,
    `Afford to Fix All Issues in Minutes per per 1000 Lines of Code`,
    (diff) =>
      diff.measures.affordToFixInHoursPer1000Lines.newEntry.value);
  showTop5ByKeySelector(diffs,
    `Afford to Fix All Issues in Minutes per per 1000 Lines of Code Improvement`,
    (diff) =>
      diff.measures.affordToFixInHoursPer1000Lines.deltaAbsolute);
}

(function () {
  'use strict';

  let currentDiffs = []

  console.log(`Loading components metrics from ${threeMonthAgo()}`)

  fetchAllComponents()
    .then(components => shuffle(components)
      .forEach(component =>
        fetchMetricsFor(component)
          .then(componentMetricResponse =>
            toComponentMetricDiff(component, componentMetricResponse))
          .then(diff => {
            if (diff.measures) {
              currentDiffs = [...currentDiffs, diff]
            }
          })
          .then(() => showRanks(currentDiffs))
          .catch(console.error)
      ))
    .catch(console.error)
})();

