import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from 'cheerio';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/overview.tsx',import.meta.url),'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exports = {};
new Function('require','exports',compiled)(name => {
  if(name === 'next/link') return {default: props => React.createElement('a', props)};
  if(name === '@/components/morrow-icons') return {ArrowUpRightIcon: () => null};
  return require(name);
},exports);
const metrics = {competitors:3,activeCompetitors:3,monitoredPages:3,activePages:3,healthyPages:3,overduePages:0,awaitingPages:0,errorPages:0,pausedPages:0,changes:43,majorChanges:10,latestCheckedAt:'2026-10-11T02:55:00Z',latestChangeAt:'2026-10-09T02:46:00Z'};
const usage = {competitorLimit:10,pageLimit:50,perCompetitorPageLimit:10,competitorRemaining:7,pageRemaining:47};
const monitoringRows = Array.from({length:3},(_,i)=>({id:`page-${i}`,competitor_id:`competitor-${i}`,competitor_name:`Complete competitor name ${i}`,competitor_domain:`example-${i}.test`,label:`Page label ${i}`,url:`https://example-${i}.test/full/monitored/path`,frequency_minutes:1440,page_status:'active',competitor_status:'active',last_checked_at:'2026-10-10T22:46:00Z',next_check_at:'2026-10-11T22:46:00Z',latest_http_status:200,latest_captured_at:'2026-10-10T22:46:00Z',health:'healthy'}));
const recentChanges = Array.from({length:8},(_,i)=>({id:`change-${i}`,category:'content',significance:i%2?'moderate':'minor',summary:`Complete untruncated change title ${i}: detailed wording that must remain available.`,why_it_matters:`Complete descriptive paragraph ${i} with all original detail.`,detected_at:`2026-10-${String(9-i).padStart(2,'0')}T02:46:00Z`,competitor_id:`competitor-${i%3}`,competitor_name:`Complete competitor name ${i%3}`,monitored_page_url:monitoringRows[i%3].url,monitored_page_label:`Page label ${i%3}`}));
const render = overrides => load(renderToStaticMarkup(React.createElement(exports.DashboardOverview,{metrics,usage,monitoringRows,recentChanges,...overrides})));

test('dashboard keeps all metrics, zero health states, monitored pages, distinct timings and usage facts',()=>{
 const $=render();
 assert.deepEqual($('.workspace-metric-value').map((i,e)=>$(e).text()).get(),['3','3','43','0']);
 assert.deepEqual($('.workspace-health-cell').map((i,e)=>$(e).text()).get(),['Healthy3','Overdue0','Awaiting first capture0','Capture errors0','Paused0']);
 assert.equal($('.monitoring-record').length,3);
 $('.monitoring-record').each((i,e)=>{
  const row=$(e);
  for(const text of [monitoringRows[i].competitor_name,monitoringRows[i].label,monitoringRows[i].url,'Healthy','Daily','HTTP 200']) assert.ok(row.text().includes(text),text);
  assert.deepEqual(row.find('dt').map((j,n)=>$(n).text()).get(),['Last checked','Latest capture','Next check']);
  assert.equal(row.find('details').length,0,'Schedule facts remain visible without expansion');
 });
 const summary=$('.workspace-usage-summary');
 for(const text of ['3 / 10','7 competitors remaining','3 / 50','47 pages remaining','Per-competitor page cap','10']) assert.ok(summary.text().includes(text),text);
 assert.equal(summary.parents('details').length,0,'Capacity figures stay outside the help disclosure');
 assert.ok($('.workspace-usage-copy').text().includes('These are launch safety caps, not subscription or billing limits.'));
 assert.ok($('.workspace-usage-copy').text().includes('Each competitor can contain up to 10 monitored pages. Paused pages still count toward capacity.'));
 assert.ok($('.workspace-latest').text().includes('11 Oct 2026, 02:55 UTC'));
 assert.ok($('.workspace-latest').text().includes('9 Oct 2026, 02:46 UTC'));
});

test('all eight changes retain their order, full title, metadata, description and individual disclosure',()=>{
 const $=render();
 assert.equal($('.change-record').length,8);
 $('.change-record').each((i,e)=>{
  const row=$(e),change=recentChanges[i];
  assert.equal(row.find('summary h3').text(),change.summary);
  assert.ok(row.find('.change-identity').text().includes(change.competitor_name));
  assert.ok(row.find('.change-identity').text().includes(change.monitored_page_label));
  assert.ok(row.find('.workspace-record-meta').text().includes(change.category));
  assert.ok(row.find('.workspace-record-meta').text().includes(change.significance));
  assert.ok(row.find('time').text().endsWith('UTC'));
  assert.equal(row.find('.workspace-change-description p').text(),change.why_it_matters);
  assert.equal(row.find('details').attr('open'),undefined);
  assert.equal(row.find('details').attr('name'),undefined,'Multiple entries can be expanded independently');
  assert.equal(row.find('summary a').length,0,'Disclosure and detail navigation stay distinct');
  assert.equal(row.find('.workspace-change-description a').attr('href'),`/dashboard/changes/${change.id}`);
 });
 const html=$('main').html();
 assert.ok(html.indexOf('dashboard-monitoring')<html.indexOf('dashboard-usage'));
 assert.ok(html.indexOf('dashboard-usage')<html.indexOf('dashboard-changes'));
});

test('empty and unhealthy states retain their labels, diagnostic counts and scheduling facts',()=>{
 const empty=render({monitoringRows:[],recentChanges:[]});
 assert.ok(empty('main').text().includes('Nothing is being monitored yet'));
 assert.ok(empty('main').text().includes('No changes yet'));
 const $=render({metrics:{...metrics,overduePages:1,errorPages:1,healthyPages:0},monitoringRows:['overdue','error','paused'].map((health,i)=>({...monitoringRows[i],health,latest_http_status:health==='error'?500:null}))});
 assert.equal($('.workspace-metric-value').last().text(),'2');
 assert.deepEqual($('.monitoring-record .workspace-badge').map((i,e)=>$(e).text()).get(),['Overdue','Capture error','Paused']);
 assert.equal($('.monitoring-record').last().find('dd').last().text(),'Paused');
 assert.ok($('.monitoring-record').eq(1).text().includes('HTTP 500'));
});
