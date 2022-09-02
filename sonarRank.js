// ==UserScript==
// @name         Sonar Project Rank
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://sonar.prod.ccs.gematik.solutions/projects**
// @icon         https://sonar.prod.ccs.gematik.solutions/apple-touch-icon.png
// @require      https://cdnjs.cloudflare.com/ajax/libs/date-fns/1.30.1/date_fns.min.js
// @grant        none
// ==/UserScript==

const metrics = ["sqale_index", "coverage"]
const topCount = 5;

/**
 * Diff
 * @typedef {{
 *   componentKey: String,
 *   componentName: String,
 *   measures: {
 *   coverage: {
 *      deltaAbsolute: Number,
 *      deltaRelative: Number,
 *      oldEntry: {
 *        date: String,
 *        value: Number
 *      },
 *      newEntry: {
 *        date: String,
 *        value: Number
 *      }
 *    },
 *    sqale_index: {
 *      deltaAbsolute: Number,
 *      deltaRelative: Number,
 *      oldEntry: {
 *        date: String,
 *        value: Number
 *      },
 *      newEntry: {
 *        date: String,
 *        value: Number
 *      }
 *    }
 *   }
 * }} Diff
 */

function threeMonthAgo() {
  return dateFns.format(dateFns.subDays(new Date(), 90), "YYYY-MM-DD")
}

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

function toComponentMetricDiff(component, componentMetricResponse) {
  return {
    componentKey: component.key,
    componentName: component.name,
    measures: componentMetricResponse.measures.reduce((a, b) => {
      const result = {...a};

      const oldEntry = b.history[0];
      const newEntry = b.history[b.history.length - 1];
      const deltaAbsolute = newEntry?.value - oldEntry?.value

      result[b.metric] = {
        oldEntry,
        newEntry,
        deltaAbsolute,
        deltaRelative: deltaAbsolute ? (100 * deltaAbsolute / oldEntry.value) : undefined
      }
      return result
    }, {})
  };
}

/**
 * @param {Diff} diff
 */
function hasCoverage(diff) {
  return diff.measures?.coverage?.newEntry?.value;
}

/**
 * @param {Diff[]} diffs
 */
function showTopAbsoluteCoverageFor(diffs) {
  console.log(`=== Top ${topCount} Coverage ===`)
  diffs
    .filter(it => hasCoverage(it))
    .sort((a, b) => b.measures?.coverage?.newEntry?.value - a.measures?.coverage?.newEntry?.value)
    .slice(0, topCount)
    .forEach((it, index) => console.log(
      `${index + 1}: "${it.componentName}" - "${it.componentKey}"
\t ${it.measures.coverage.newEntry.value}% - @${it.measures.coverage.newEntry.date.substring(0,
        10)}
\t ${it.measures.coverage.oldEntry.value}% - @${it.measures.coverage.oldEntry.date.substring(0,
        10)}
\t https://sonar.prod.ccs.gematik.solutions/dashboard?id=${it.componentKey}`))
}

/**
 * @param {Diff[]} diffs
 */
function showTopCoverageImprovementFor(diffs) {
  console.log(`=== Top ${topCount} Coverage Improvement ===`)

  diffs
    .filter(it => hasCoverage(it) && it.measures.coverage.deltaAbsolute)
    .sort((a, b) => {
        return b.measures?.coverage?.deltaRelative - a.measures?.coverage?.deltaRelative;
      }
    )
    .slice(0, topCount)
    .forEach((it, index) => console.log(`${index + 1}: "${it.componentName}" - "${it.componentKey}"
\t ${it.measures?.coverage?.deltaRelative.toFixed(
      1)}% changed relative to ${it.measures.coverage.newEntry.date.substring(
      0,
      10)}
\t ${it.measures?.coverage?.deltaAbsolute.toFixed(
      1)}% changed absolute to ${it.measures.coverage.newEntry.date.substring(
      0,
      10)}
\t ${it.measures.coverage.newEntry.value}% - @${it.measures.coverage.newEntry.date.substring(0,
      10)}
\t ${it.measures.coverage.oldEntry.value}% - @${it.measures.coverage.oldEntry.date.substring(0,
      10)}
\t https://sonar.prod.ccs.gematik.solutions/dashboard?id=${it.componentKey}`))
}

/**
 * @param {Diff[]} diffs
 */
function showTopAbsoluteTechnicalDeptFor(diffs) {
  console.log(`=== Top ${topCount} Technical Dept (Squale Index) ===`)
  diffs
    .filter(it => hasCoverage(it))
    .sort(
      (a, b) => a.measures?.sqale_index?.newEntry?.value - b.measures?.sqale_index?.newEntry?.value)
    .slice(0, topCount)
    .forEach((it, index) => console.log(
      `${index + 1}: "${it.componentName}" - "${it.componentKey}"
\t ${it.measures.sqale_index.newEntry.value} - @${it.measures.sqale_index.newEntry.date.substring(
        0,
        10)}
\t ${it.measures.sqale_index.oldEntry.value} - @${it.measures.sqale_index.oldEntry.date.substring(
        0,
        10)}
\t https://sonar.prod.ccs.gematik.solutions/dashboard?id=${it.componentKey}`))
}

/**
 * @param {Diff[]} diffs
 */
function showTopTechnicalDeptImprovementFor(diffs) {
  console.log(`=== Top ${topCount} Coverage Improvement ===`)

  diffs
    .filter(it => hasCoverage(it) && it.measures.sqale_index.deltaAbsolute)
    .sort((a, b) => {
        return a.measures?.sqale_index?.deltaRelative - b.measures?.sqale_index?.deltaRelative;
      }
    )
    .slice(0, topCount)
    .forEach((it, index) => console.log(`${index + 1}: "${it.componentName}" - "${it.componentKey}"
\t ${it.measures?.sqale_index?.deltaRelative.toFixed(
      1)}% changed relative to ${it.measures.sqale_index.newEntry.date.substring(
      0,
      10)}
\t ${it.measures?.sqale_index?.deltaAbsolute.toFixed(
      1)} changed absolute to ${it.measures.sqale_index.newEntry.date.substring(
      0,
      10)}
\t ${it.measures.sqale_index.newEntry.value}% - @${it.measures.sqale_index.newEntry.date.substring(
      0,
      10)}
\t ${it.measures.sqale_index.oldEntry.value}% - @${it.measures.sqale_index.oldEntry.date.substring(
      0,
      10)}
\t https://sonar.prod.ccs.gematik.solutions/dashboard?id=${it.componentKey}`))
}

/**
 * @param {Diff[]} diffs
 */
function showRanks(diffs) {
  console.clear()
  console.log(`This Script shows only Projects with changes since ${threeMonthAgo()}`)
  showTopAbsoluteCoverageFor(diffs);
  showTopCoverageImprovementFor(diffs);
  showTopAbsoluteTechnicalDeptFor(diffs);
  showTopTechnicalDeptImprovementFor(diffs);
}

(function () {
  'use strict';

  let currentDiffs = []

  console.log(`Loading components metrics from ${threeMonthAgo()}`)

  fetchAllComponents()
    .then(components => components
      .forEach(component =>
        fetchMetricsFor(component)
          .then(componentMetricResponse =>
            toComponentMetricDiff(component, componentMetricResponse))
          .then(newDiff => {
            currentDiffs = [...currentDiffs, newDiff]
          })
          .then(() => showRanks(currentDiffs))
          .catch(console.error)
      ))
    .catch(console.error)
})();

