// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// This shows the HTML page in "ui.html".
figma.showUI(__html__);

// Calls to "parent.postMessage" from within the HTML page will trigger this
// callback. The callback will be passed the "pluginMessage" property of the
// posted message.
figma.ui.onmessage = async (msg: {type: string, count: number}) => {
  // One way of distinguishing between different types of messages sent from
  // your HTML page is to use an object with a "type" property like this.
  // if (msg.type === 'create-shapes') {
  //   // This plugin creates rectangles on the screen.
  //   const numberOfRectangles = msg.count;
  //   console.log(numberOfRectangles, "numberOfRectangles");
  //   const nodes: SceneNode[] = [];
  //   for (let i = 0; i < numberOfRectangles; i++) {
  //     const response = await fetch("https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546");
  //     console.log(response, "response");
  //     // const arrayBuffer = await response.arrayBuffer();
  //     // console.log(arrayBuffer, "arrayBuffer");
  //     // const uint8Array = new Uint8Array(arrayBuffer);
  //     const image = await figma.createImageAsync(
  //       "https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546"
  //     );
  //     console.log(image, "image");
  //     const rect = figma.createRectangle();
  //     rect.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
  //     figma.currentPage.appendChild(rect);
  //     nodes.push(rect);
  //     // console.log(nodes, "nodes");
  //   }
  //   figma.currentPage.selection = nodes;
  //   figma.viewport.scrollAndZoomIntoView(nodes);
  // }

  // This plugin creates rectangles on the screen.
  // const numberOfRectangles = msg.count;

  // const nodes: SceneNode[] = [];
  // for (let i = 0; i < numberOfRectangles; i++) {
  //   const rect = figma.createRectangle();
  //   rect.x = i * 150;
  //   rect.fills = [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0 } }];
  //   figma.currentPage.appendChild(rect);
  //   nodes.push(rect);
  // }
  // figma.currentPage.selection = nodes;
  // figma.viewport.scrollAndZoomIntoView(nodes);

  if (msg.type === "create-shapes") {
    const numberOfRectangles = msg.count;

    const nodes: SceneNode[] = [];
    const proxyUrl = "https://api.allorigins.win/get?url=";
    const imageUrl = encodeURIComponent(
      "https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546"
    );
    const response = await fetch(proxyUrl + imageUrl);
    const data = await response.json();
    const image = await figma.createImageAsync(data.contents);
    for (let i = 0; i < numberOfRectangles; i++) {
      
      console.log(image, "image");
      const rect = figma.createRectangle();
      rect.x = i * 150;
      rect.fills = [
        { type: "IMAGE", scaleMode: "FILL", imageHash: image.hash },
      ];
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
  }

  // Make sure to close the plugin when you're done. Otherwise the plugin will
  // keep running, which shows the cancel button at the bottom of the screen.
  figma.closePlugin();
};
