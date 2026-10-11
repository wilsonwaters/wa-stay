import type { EventEmitter } from 'events';
import {
  AutoUpdaterService,
  DOWNLOAD_FAILED_MESSAGE,
} from '@main/services/updater/auto-updater.service';
import { AppError } from '@main/utils/app-error';

jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('@main/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { autoUpdater } = jest.requireMock('electron-updater') as {
  autoUpdater: EventEmitter & { checkForUpdates: jest.Mock; downloadUpdate: jest.Mock };
};

describe('AutoUpdaterService', () => {
  let emit: jest.Mock;
  let service: AutoUpdaterService;

  beforeEach(() => {
    autoUpdater.removeAllListeners();
    autoUpdater.checkForUpdates.mockReset();
    autoUpdater.downloadUpdate.mockReset();
    emit = jest.fn();
    service = new AutoUpdaterService({ emit });
  });

  it('a failed check (offline, or no release feed) is logged and never reaches the update card', async () => {
    autoUpdater.checkForUpdates.mockImplementation(async () => {
      const error = new Error('HttpError: 404 Not Found');
      autoUpdater.emit('error', error);
      throw error;
    });

    await expect(service.checkForUpdates()).resolves.toBeNull();
    expect(emit).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ state: 'error' });
  });

  it('a failed download reaches the card in plain words and rejects with the same message', async () => {
    autoUpdater.downloadUpdate.mockImplementation(async () => {
      const error = new Error('net::ERR_CONNECTION_RESET');
      autoUpdater.emit('error', error);
      throw error;
    });

    const download = service.downloadUpdate();
    await expect(download).rejects.toBeInstanceOf(AppError);
    await expect(download).rejects.toMatchObject({
      code: 'INTERNAL',
      message: DOWNLOAD_FAILED_MESSAGE,
    });
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('updater:error', { error: DOWNLOAD_FAILED_MESSAGE });
  });

  it('after a download settles, a later background error stays silent', async () => {
    autoUpdater.downloadUpdate.mockResolvedValue(undefined);
    await service.downloadUpdate();

    autoUpdater.emit('error', new Error('ENOTFOUND github.com'));
    expect(emit).not.toHaveBeenCalled();
  });
});
