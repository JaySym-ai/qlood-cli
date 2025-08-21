import clipboard from 'clipboardy';

export async function copyText(text) {
  await clipboard.write(text);
}

export async function pasteText() {
  return clipboard.read();
}

