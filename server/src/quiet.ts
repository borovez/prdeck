// Silence node:sqlite's ExperimentalWarning (must be imported before db.ts).
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.error(w)
})
