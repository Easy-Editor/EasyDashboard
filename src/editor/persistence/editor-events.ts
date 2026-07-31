export const EDITOR_SAVE_REQUEST_EVENT = 'easy-dashboard:save-request'

export function requestEditorSave() {
  window.dispatchEvent(new Event(EDITOR_SAVE_REQUEST_EVENT))
}
