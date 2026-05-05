import { JOB_TYPES } from '@insta2figma/shared-contracts';

function assertWorkspaceContractsLinked(): void {
  if (JOB_TYPES.length !== 2) {
    throw new Error('@insta2figma/shared-contracts inesperadamente vazio');
  }
}

assertWorkspaceContractsLinked();

figma.showUI(__html__);

figma.ui.onmessage = async (msg: { type: string; count?: number }) => {
  if (msg.type === 'create-shapes' && typeof msg.count === 'number') {
    const numberOfRectangles = msg.count;
    const nodes: SceneNode[] = [];
    const proxyUrl = 'https://api.allorigins.win/get?url=';
    const imageUrl = encodeURIComponent(
      'https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546',
    );
    const response = await fetch(proxyUrl + imageUrl);
    const data = (await response.json()) as { contents?: string };
    const imageSource = data.contents ?? '';
    const image = await figma.createImageAsync(imageSource);
    for (let i = 0; i < numberOfRectangles; i++) {
      const rect = figma.createRectangle();
      rect.x = i * 150;
      rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }

  figma.closePlugin();
};
