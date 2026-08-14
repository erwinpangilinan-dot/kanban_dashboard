const test = require('node:test');
const assert = require('node:assert');

const {
  jobPredatesRun,
  resolveSessionLauncherId,
  extractFailureDetailFromStdout,
  normalizeCiqSource,
  buildDeploymentPayload,
  ATLAS_CIQ_SOURCES,
  atlasSettingsPublic,
} = require('../src/services/network-samsung-precheck');

// Reproduces the 29991573162 incident: a deployment relaunched on Aug 8 kept
// reporting the failed Atlas job from the Aug 7 run.
const PREVIOUS_RUN_JOB = 11204259;
const CURRENT_RUN_JOB = 11213388;
const PREVIOUS_LAUNCH = '2026-08-07T21:43:11.747752Z';
const CURRENT_LAUNCH = '2026-08-08T18:10:22.193Z';

test('jobPredatesRun flags a job that started before the current launch', () => {
  const oldJob = { started: PREVIOUS_LAUNCH, finished: '2026-08-07T21:53:42.028418Z' };
  assert.equal(jobPredatesRun(oldJob, CURRENT_LAUNCH), true);
});

test('jobPredatesRun accepts the job started by the current launch', () => {
  const newJob = { started: '2026-08-08T18:10:27.018105Z', finished: null };
  assert.equal(jobPredatesRun(newJob, CURRENT_LAUNCH), false);
});

test('jobPredatesRun tolerates small clock drift around the launch', () => {
  const justBefore = { started: '2026-08-08T18:10:17.000Z', finished: null };
  assert.equal(jobPredatesRun(justBefore, CURRENT_LAUNCH), false);
});

test('jobPredatesRun is inert without a launch timestamp', () => {
  assert.equal(jobPredatesRun({ started: PREVIOUS_LAUNCH }, null), false);
});

test('a newer launcher supersedes the stored session anchor', () => {
  const stored = {
    session_launcher_job_id: PREVIOUS_RUN_JOB,
    launcher_job_id: PREVIOUS_RUN_JOB,
  };
  assert.equal(
    resolveSessionLauncherId(stored, CURRENT_RUN_JOB, CURRENT_RUN_JOB),
    CURRENT_RUN_JOB
  );
});

test('the stored session anchor is kept while the same run is polled', () => {
  const stored = {
    session_launcher_job_id: CURRENT_RUN_JOB,
    launcher_job_id: CURRENT_RUN_JOB,
  };
  assert.equal(
    resolveSessionLauncherId(stored, CURRENT_RUN_JOB, CURRENT_RUN_JOB),
    CURRENT_RUN_JOB
  );
});

test('an older explicit launcher does not drag the anchor backwards', () => {
  const stored = { session_launcher_job_id: CURRENT_RUN_JOB };
  assert.equal(
    resolveSessionLauncherId(stored, PREVIOUS_RUN_JOB, PREVIOUS_RUN_JOB),
    CURRENT_RUN_JOB
  );
});

test('without any explicit launcher the earliest session job wins', () => {
  const stored = {
    launcher_job_id: CURRENT_RUN_JOB,
    activity: { recent: [{ job_id: CURRENT_RUN_JOB + 16 }, { job_id: CURRENT_RUN_JOB + 4 }] },
  };
  assert.equal(resolveSessionLauncherId(stored, null, null), CURRENT_RUN_JOB);
});

test('no stored snapshot and no launcher yields no anchor', () => {
  assert.equal(resolveSessionLauncherId(null, null, null), null);
});

// The DAY0 ACTION stdout from job 11213443, trimmed to the shape that matters.
const DAY0_STDOUT = {
  content: [
    'INFO [nfvd.py:151 - _deploy_cnf_action()] url https://me.orchestration.vnf.vzwnet.com:8448/api/v2/orchestration/cnf/deploy',
    'ERROR [nfvd.py:165] Atlas API for https://me.orchestration.vnf.vzwnet.com:8448/api/v2/orchestration/cnf/deploy failed on attempt  1: 404 Client Error: Not Found for url: https://me.orchestration.vnf.vzwnet.com:8448/api/v2/orchestration/cnf/deploy',
    'ERROR [nfvd.py:165] Atlas API for https://me.orchestration.vnf.vzwnet.com:8448/api/v2/orchestration/cnf/deploy failed on attempt  2: 404 Client Error: Not Found for url: https://me.orchestration.vnf.vzwnet.com:8448/api/v2/orchestration/cnf/deploy',
    'ERROR [vdu.py:430 - deploy()] Error occurred during API launch request: Atlas API failed - Max number of retries reached: 404 Client Error: Not Found',
    'fatal: [VAPP_ME_LAB_02]: FAILED! => {"msg": "Deploy for fuzeProjectId=17674239 gnbDuId=29991573162 failed"}',
  ].join('\n'),
};

test('the upstream API error is preferred over the generic Ansible wrapper', () => {
  const detail = extractFailureDetailFromStdout(DAY0_STDOUT);
  assert.match(detail, /Error occurred during API launch request/);
  assert.match(detail, /404/);
  assert.doesNotMatch(detail, /fatal: \[VAPP_ME_LAB_02\]/);
});

test('per-attempt retry noise does not crowd out the real cause', () => {
  const detail = extractFailureDetailFromStdout(DAY0_STDOUT);
  assert.equal(detail.split('\n').length, 1, `expected a single line, got:\n${detail}`);
  assert.doesNotMatch(detail, /on attempt/);
});

test('the Ansible wrapper is still used when nothing better exists', () => {
  const detail = extractFailureDetailFromStdout({
    content: 'fatal: [VAPP_ME_LAB_02]: FAILED! => {"msg": "something broke"}',
  });
  assert.match(detail, /fatal: \[VAPP_ME_LAB_02\]/);
});

test('empty stdout yields no detail', () => {
  assert.equal(extractFailureDetailFromStdout({ content: '   ' }), null);
  assert.equal(extractFailureDetailFromStdout(null), null);
});

test('both CIQ sources are offered', () => {
  assert.deepEqual([...ATLAS_CIQ_SOURCES].sort(), ['CONQUEST_LAB', 'MARKET_PLACE']);
});

test('a chosen CIQ source is accepted and upper-cased', () => {
  assert.equal(normalizeCiqSource('CONQUEST_LAB'), 'CONQUEST_LAB');
  assert.equal(normalizeCiqSource('conquest_lab'), 'CONQUEST_LAB');
  assert.equal(normalizeCiqSource('  market_place  '), 'MARKET_PLACE');
});

test('an unset CIQ source falls back to the default rather than failing', () => {
  assert.equal(normalizeCiqSource(undefined), 'MARKET_PLACE');
  assert.equal(normalizeCiqSource(null), 'MARKET_PLACE');
  assert.equal(normalizeCiqSource('   '), 'MARKET_PLACE');
});

test('an unknown CIQ source is rejected before reaching Atlas', () => {
  assert.throws(() => normalizeCiqSource('LAB'), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /CONQUEST_LAB/);
    return true;
  });
});

test('the settings endpoint offers the CIQ choices to the UI', async () => {
  const settings = await atlasSettingsPublic();
  assert.deepEqual(settings.ciq_sources, [...ATLAS_CIQ_SOURCES]);
  assert.ok(ATLAS_CIQ_SOURCES.includes(settings.default_ciq_source));
});

test('the deployment payload carries the selected CIQ source', () => {
  const { extra_vars } = buildDeploymentPayload(
    '29991573162',
    '25.B.0-0210',
    '17674239',
    'CONQUEST_LAB'
  );
  assert.deepEqual(extra_vars, {
    gnbDuId: '29991573162',
    version: '25.B.0-0210',
    ciqSource: 'CONQUEST_LAB',
    method: 'Orchestrator',
    fuzeProjectId: '17674239',
  });
});

const { mergePrecheckStatus } = require('../src/services/network-samsung-precheck');

// 29991512805: Grow failed mid-workflow, then Verification + parent ZeroTouch
// Undeployment finished successful — UI must not stay "still in progress".
test('mergePrecheckStatus: parent undeploy success wins over intermediate Grow failure', () => {
  const merged = mergePrecheckStatus({
    monitorJobSummary: {
      job_id: 11276090,
      name: 'FOA ONLY Samsung vDU Grow',
      status: 'failed',
      terminal: true,
      job_explanation: 'VAPP_ME_LAB_02 : failed=1',
    },
    launcherJobSummary: {
      job_id: 11276073,
      name: 'FOA ONLY Samsung vDU ZeroTouch Undeployment',
      status: 'success',
      terminal: true,
    },
    activitySummary: null,
    waitingForWrapper: false,
    operation: 'undeployment',
    workload: 'VDU',
  });
  assert.equal(merged.status, 'success');
  assert.equal(merged.phase, 'complete');
  assert.match(merged.message, /successful/i);
  assert.doesNotMatch(merged.message, /still in progress/i);
});

test('mergePrecheckStatus: successful ZeroTouch workflow job is complete, not awaiting postcheck', () => {
  const merged = mergePrecheckStatus({
    monitorJobSummary: {
      job_id: 11276073,
      name: 'FOA ONLY Samsung vDU ZeroTouch Undeployment',
      status: 'success',
      terminal: true,
    },
    launcherJobSummary: {
      job_id: 11276073,
      name: 'FOA ONLY Samsung vDU ZeroTouch Undeployment',
      status: 'success',
      terminal: true,
    },
    activitySummary: null,
    waitingForWrapper: false,
    operation: 'undeployment',
    workload: 'VDU',
  });
  assert.equal(merged.status, 'success');
  assert.equal(merged.phase, 'complete');
  assert.doesNotMatch(merged.message, /awaiting final/i);
});

test('mergePrecheckStatus: waitingForWrapper + successful deploy workflow ends Waiting', () => {
  const merged = mergePrecheckStatus({
    monitorJobSummary: null,
    launcherJobSummary: {
      job_id: 11279340,
      name: 'FOA Samsung vDU ZeroTouch Deployment V2',
      status: 'success',
      terminal: true,
    },
    activitySummary: {
      recent: [
        {
          summary: 'FOA Samsung vDU ZeroTouch Deployment V2',
          status: 'success',
        },
      ],
    },
    waitingForWrapper: true,
    operation: 'deployment',
    workload: 'VDU',
  });
  assert.equal(merged.status, 'success');
  assert.equal(merged.phase, 'complete');
  assert.doesNotMatch(merged.message, /in progress|Waiting|waiting/i);
  assert.match(merged.message, /successful/i);
});

test('mergePrecheckStatus: intermediate Grow failure stays running while parent still open', () => {
  const merged = mergePrecheckStatus({
    monitorJobSummary: {
      job_id: 11276090,
      name: 'FOA ONLY Samsung vDU Grow',
      status: 'failed',
      terminal: true,
    },
    launcherJobSummary: {
      job_id: 11276073,
      name: 'FOA ONLY Samsung vDU ZeroTouch Undeployment',
      status: 'running',
      terminal: false,
    },
    activitySummary: null,
    waitingForWrapper: false,
    operation: 'undeployment',
    workload: 'VDU',
  });
  assert.equal(merged.status, 'running');
  assert.match(merged.message, /still in progress/i);
});
