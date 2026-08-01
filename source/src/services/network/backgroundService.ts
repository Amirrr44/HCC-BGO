import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';

export const BACKGROUND_NOTIF_ID = 1001;

export class BackgroundService {
  private static async registerActions() {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'CHAT_BACKGROUND_ACTIONS',
          actions: [
            {
              id: 'reopen_app',
              title: 'Open Chat',
              foreground: true
            },
            {
              id: 'close_app',
              title: 'Exit App',
              destructive: true,
              foreground: false
            }
          ]
        }
      ]
    });
  }

  static async showBackgroundNotification() {
    await this.registerActions();

    await LocalNotifications.schedule({
      notifications: [
        {
          id: BACKGROUND_NOTIF_ID,
          title: 'Chat is active in background',
          body: 'Receiving new messages...',
          actionTypeId: 'CHAT_BACKGROUND_ACTIONS',
          ongoing: true,
          autoCancel: false,
        }
      ]
    });
  }

  static async clearNotification() {
    await LocalNotifications.cancel({
      notifications: [{ id: BACKGROUND_NOTIF_ID }]
    });
  }

  static initListeners() {
    LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
      if (action.actionId === 'close_app') {
        await this.clearNotification();
        App.exitApp();
      } else if (action.actionId === 'reopen_app') {
        await this.clearNotification();
      }
    });
  }
}
