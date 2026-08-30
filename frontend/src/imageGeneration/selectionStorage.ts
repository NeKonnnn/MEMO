const IMAGE_GEN_MODE_KEY = 'astrachat_image_generation_mode';

const VIDEO_GEN_MODE_KEY = 'astrachat_video_generation_mode';



function chatKey(base: string, chatId: string | null | undefined): string {

  return chatId ? `${base}:${chatId}` : base;

}



export function isImageGenerationModeEnabled(chatId?: string | null): boolean {

  try {

    return localStorage.getItem(chatKey(IMAGE_GEN_MODE_KEY, chatId)) === 'true';

  } catch {

    return false;

  }

}



export function setImageGenerationModeEnabled(chatId: string | null | undefined, enabled: boolean): void {

  try {

    localStorage.setItem(chatKey(IMAGE_GEN_MODE_KEY, chatId), enabled ? 'true' : 'false');

  } catch {

    // ignore

  }

}



export function isVideoGenerationModeEnabled(chatId?: string | null): boolean {

  try {

    return localStorage.getItem(chatKey(VIDEO_GEN_MODE_KEY, chatId)) === 'true';

  } catch {

    return false;

  }

}



export function setVideoGenerationModeEnabled(chatId: string | null | undefined, enabled: boolean): void {

  try {

    localStorage.setItem(chatKey(VIDEO_GEN_MODE_KEY, chatId), enabled ? 'true' : 'false');

  } catch {

    // ignore

  }

}



export function isAnyGenerationModeEnabled(chatId?: string | null): boolean {

  return isImageGenerationModeEnabled(chatId) || isVideoGenerationModeEnabled(chatId);

}



export function dispatchGenerationModeChanged(): void {

  window.dispatchEvent(new CustomEvent('astrachatImageGenModeChanged'));

  window.dispatchEvent(new CustomEvent('astrachatVideoGenModeChanged'));

  window.dispatchEvent(new CustomEvent('astrachatGenerationModeChanged'));

}



export function enableImageGenerationFromGearPanel(chatId: string | null | undefined): void {

  setImageGenerationModeEnabled(chatId, true);

  dispatchGenerationModeChanged();

}



export function disableAllGenerationModes(chatId: string | null | undefined): void {

  setImageGenerationModeEnabled(chatId, false);

  setVideoGenerationModeEnabled(chatId, false);

  dispatchGenerationModeChanged();

}


