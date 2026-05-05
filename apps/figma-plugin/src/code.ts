import { JOB_TYPES } from '@insta2figma/shared-contracts';

function assertWorkspaceContractsLinked(): void {
  if (JOB_TYPES.length !== 2) {
    throw new Error('@insta2figma/shared-contracts inconsistente');
  }
}

assertWorkspaceContractsLinked();

figma.showUI(__html__, { width: 360, height: 220 });

const SAMPLE_JPEG_URL =
  'https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546';

async function loadSampleImage(): Promise<Image> {
  const res = await fetch(SAMPLE_JPEG_URL);
  if (!res.ok) {
    throw new Error(`Download da imagem falhou (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return figma.createImage(bytes);
}

async function loadSampleImageOrNull(): Promise<Image | null> {
  try {
    return await loadSampleImage();
  } catch (e) {
    console.warn('[Insta2Figma] Fallback sem imagem de exemplo:', e);
    return null;
  }
}

figma.ui.onmessage = async (msg: { type: string; count?: number }) => {
  if (msg.type === 'cancel') {
    figma.closePlugin();
    return;
  }

  if (msg.type !== 'create-shapes') {
    return;
  }

  if (
    typeof msg.count !== 'number' ||
    !Number.isInteger(msg.count) ||
    msg.count <= 0
  ) {
    figma.notify('Indica um número inteiro positivo.', { error: true });
    return;
  }

  try {
    const image = await loadSampleImageOrNull();
    if (!image) {
      figma.notify(
        'Não foi possível carregar a imagem do Instagram (CDN / rede). A criar rectângulos sólidos como fallback.',
      );
    }
    const nodes: SceneNode[] = [];
    const fill: RectangleNode['fills'] =
      image != null
        ? [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }]
        : [{ type: 'SOLID', color: { r: 0.2, g: 0.5, b: 0.95 } }];
    for (let i = 0; i < msg.count; i++) {
      const rect = figma.createRectangle();
      rect.x = i * 150;
      rect.fills = fill;
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
    figma.closePlugin();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    figma.notify(`Insta2Figma: ${text}`, { error: true });
    console.error('[Insta2Figma]', err);
  }
};
