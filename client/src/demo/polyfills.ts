// Серверный код ждёт Node: даём ему минимальный `process` и `Buffer` до загрузки остальных модулей.
const g = globalThis as any;
g.process ??= { env: {}, argv: [], exit() {}, platform: 'browser', cwd: () => '/' };
g.process.env ??= {};
g.global ??= globalThis;
export {};
