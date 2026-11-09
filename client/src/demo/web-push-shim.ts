// В демо-версии системных уведомлений нет: серверный модуль web-push (ему нужен Node) заменён пустышкой.
export default {
  generateVAPIDKeys: () => ({ publicKey: '', privateKey: '' }),
  setVapidDetails: () => {},
  sendNotification: async () => {},
};
