// A worker that keeps running until it is signalled.
setInterval(() => {}, 1000);
process.on("SIGTERM", () => process.exit(0));
