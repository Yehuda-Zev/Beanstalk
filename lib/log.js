// One JSON object per line. Render shows these in the service Logs tab.
// Never pass secrets or emails in here: log user ids only.
function log(event, fields = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

function logError(event, err, fields = {}) {
  console.error(
    JSON.stringify({
      t: new Date().toISOString(),
      event,
      error: err && err.message ? err.message : String(err),
      ...fields,
    })
  );
}

module.exports = { log, logError };
