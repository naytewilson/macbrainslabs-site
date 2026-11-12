// Pass criteria a package research record may name for each arm
// (attestation replication.arms[].passCriterion). A record names the criterion
// its clean-room tool's log supports. An unknown criterion is never a pass.
export const PKG_PASS_CRITERIA = Object.freeze({
  // v0.3.0: the older Fugu tool build logs no "passed" field, only the exit code and the byte comparison.
  'run_completed with exitCode 0 and byteIdentical true (and passed true where the log records it)':
    x => x.exitCode === 0 && x.byteIdentical === true && (x.passed === undefined || x.passed === true),
  // v0.4.0: the tool logs exitCode and passed but no byte comparison; byte identity across runs
  // is shown by the recompute packaged with the record, not by the log line.
  'run_completed with exitCode 0 and passed true; byte identity across runs is checked by the packaged recompute, not by the log':
    x => x.exitCode === 0 && x.passed === true
});
export const pkgPassCriterion = name => typeof name === 'string' && Object.hasOwn(PKG_PASS_CRITERIA, name) ? PKG_PASS_CRITERIA[name] : null;
