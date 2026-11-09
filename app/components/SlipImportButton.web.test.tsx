// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => import('react-native-web'));
vi.mock('../lib/fonts', () => ({
  fonts: {
    monoBold: 'system',
    monoMedium: 'system',
    monoSemiBold: 'system',
    sansBold: 'system',
    sansSemiBold: 'system',
    teamNickname: 'system',
  },
}));
const web = vi.hoisted(() => ({
  pickSlipImage: vi.fn<() => Promise<string | null>>(),
  readSlipFile: vi.fn<(file: File) => Promise<string>>(),
  isImageFile: (file: File) => file.type.startsWith('image/'),
}));
vi.mock('../lib/slipImage.web', () => web);

import { SlipImportButton } from './SlipImportButton.web';

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('SlipImportButton (web)', () => {
  let root: Root;
  let host: HTMLDivElement;
  const onImage = vi.fn();
  const onError = vi.fn();

  function render(props: Partial<Parameters<typeof SlipImportButton>[0]> = {}) {
    act(() => {
      root.render(
        <SlipImportButton loading={false} onError={onError} onImage={onImage} {...props} />,
      );
    });
  }

  function drop(file: File) {
    const zone = host.querySelector('[data-testid="slip-import-drop-zone"]');
    if (!zone) throw new Error('no drop zone');
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    act(() => {
      zone.dispatchEvent(event);
    });
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    web.readSlipFile.mockResolvedValue('data:image/jpeg;base64,SMALL');
    web.pickSlipImage.mockResolvedValue('data:image/jpeg;base64,PICKED');
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it('imports a dropped screenshot, scaled in the browser', async () => {
    render();
    drop(new File(['x'], 'slip.png', { type: 'image/png' }));
    await flush();
    expect(web.readSlipFile).toHaveBeenCalledTimes(1);
    expect(onImage).toHaveBeenCalledWith('data:image/jpeg;base64,SMALL');
  });

  it('refuses a dropped file that is not an image', async () => {
    render();
    drop(new File(['x'], 'slip.pdf', { type: 'application/pdf' }));
    await flush();
    expect(onImage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      'Drop an image of your bet slip, like a PNG or JPEG screenshot.',
    );
  });

  it('ignores drops while locked for upgrade, and opens the upgrade instead of the picker', async () => {
    const onLocked = vi.fn();
    render({ onLocked });
    drop(new File(['x'], 'slip.png', { type: 'image/png' }));
    await flush();
    expect(onImage).not.toHaveBeenCalled();
    act(() => {
      host.querySelector<HTMLElement>('[role="button"]')?.click();
    });
    await flush();
    expect(onLocked).toHaveBeenCalled();
    expect(web.pickSlipImage).not.toHaveBeenCalled();
  });

  it('opens the file picker on tap', async () => {
    render();
    act(() => {
      host.querySelector<HTMLElement>('[role="button"]')?.click();
    });
    await flush();
    expect(onImage).toHaveBeenCalledWith('data:image/jpeg;base64,PICKED');
  });
});

describe('fitWithin', () => {
  it('scales a tall phone screenshot to the long-edge limit and never scales up', async () => {
    const actual =
      await vi.importActual<typeof import('../lib/slipImage.web')>('../lib/slipImage.web');
    expect(actual.fitWithin(1290, 2796, 2000)).toEqual({ width: 923, height: 2000 });
    expect(actual.fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});
