/**
 * Motion Graphics Adapter
 *
 * Visual editor for CSS/SVG-based motion graphics.
 * Elements on a canvas with keyframe animations, timeline control.
 */

import { z } from 'zod';

export const name = 'motion';
export const description = 'Motion Graphics Editor — CSS/SVG animations with timeline';

export function initialScene() {
  return {
    width: 1920,
    height: 1080,
    duration: 5000, // ms
    currentTime: 0,
    playing: false,
    background: '#0a0a0f',
    elements: [],
    // elements: [{ id, type, props, keyframes }]
  };
}

let elementCounter = 0;

export function registerTools(server, bus, state) {
  server.tool(
    'add_element',
    'Add a visual element to the motion graphics canvas. Types: text, shape, image, svg.',
    {
      type: z.enum(['text', 'shape', 'image', 'svg']).describe('Element type'),
      props: z.object({
        x: z.number().default(100).describe('X position'),
        y: z.number().default(100).describe('Y position'),
        width: z.number().optional().describe('Width'),
        height: z.number().optional().describe('Height'),
        text: z.string().optional().describe('Text content (for text type)'),
        fontSize: z.number().optional().describe('Font size in px'),
        fontFamily: z.string().optional().describe('Font family'),
        color: z.string().optional().describe('Text/fill color'),
        backgroundColor: z.string().optional().describe('Background color'),
        borderRadius: z.number().optional().describe('Border radius'),
        opacity: z.number().optional().describe('Opacity 0-1'),
        rotation: z.number().optional().describe('Rotation in degrees'),
        shape: z.enum(['rect', 'circle', 'ellipse']).optional().describe('Shape type'),
        src: z.string().optional().describe('Image URL (for image type)'),
        svgContent: z.string().optional().describe('SVG markup (for svg type)'),
        blur: z.number().optional().describe('Blur filter in px'),
        shadow: z.string().optional().describe('Box shadow CSS'),
        gradient: z.string().optional().describe('CSS gradient'),
        zIndex: z.number().optional().describe('Z-index for layering'),
      }).describe('Element properties'),
    },
    async ({ type, props }) => {
      const id = `el-${++elementCounter}`;
      const element = {
        id,
        type,
        props: { ...props },
        keyframes: [],
      };

      state.scene.elements = state.scene.elements || [];
      state.scene.elements.push(element);
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{
          type: 'text',
          text: `Element added: ${id} (${type})`,
        }],
      };
    }
  );

  server.tool(
    'update_element',
    'Update properties of an existing element.',
    {
      id: z.string().describe('Element ID'),
      props: z.record(z.any()).describe('Properties to update'),
    },
    async ({ id, props }) => {
      const el = state.scene.elements?.find(e => e.id === id);
      if (!el) {
        return { content: [{ type: 'text', text: `Element ${id} not found.` }] };
      }

      el.props = { ...el.props, ...props };
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{ type: 'text', text: `Element ${id} updated.` }],
      };
    }
  );

  server.tool(
    'remove_element',
    'Remove an element from the canvas.',
    {
      id: z.string().describe('Element ID'),
    },
    async ({ id }) => {
      const idx = state.scene.elements?.findIndex(e => e.id === id);
      if (idx === -1 || idx === undefined) {
        return { content: [{ type: 'text', text: `Element ${id} not found.` }] };
      }

      state.scene.elements.splice(idx, 1);
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{ type: 'text', text: `Element ${id} removed.` }],
      };
    }
  );

  server.tool(
    'add_keyframe',
    'Add a keyframe animation to an element. Keyframes define property changes at specific times.',
    {
      elementId: z.string().describe('Element ID'),
      time: z.number().describe('Time in ms when this keyframe activates'),
      props: z.record(z.any()).describe('Properties at this keyframe (x, y, opacity, rotation, scale, color, etc.)'),
      easing: z.string().optional().describe('CSS easing function (default: ease)'),
    },
    async ({ elementId, time, props, easing }) => {
      const el = state.scene.elements?.find(e => e.id === elementId);
      if (!el) {
        return { content: [{ type: 'text', text: `Element ${elementId} not found.` }] };
      }

      el.keyframes.push({ time, props, easing: easing || 'ease' });
      el.keyframes.sort((a, b) => a.time - b.time);
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{
          type: 'text',
          text: `Keyframe added to ${elementId} at ${time}ms. Total keyframes: ${el.keyframes.length}`,
        }],
      };
    }
  );

  server.tool(
    'set_timeline',
    'Control the animation timeline — play, pause, seek.',
    {
      action: z.enum(['play', 'pause', 'seek', 'reset']).describe('Timeline action'),
      time: z.number().optional().describe('Seek time in ms (for seek action)'),
    },
    async ({ action, time }) => {
      switch (action) {
        case 'play':
          state.scene.playing = true;
          break;
        case 'pause':
          state.scene.playing = false;
          break;
        case 'seek':
          state.scene.currentTime = time || 0;
          break;
        case 'reset':
          state.scene.currentTime = 0;
          state.scene.playing = false;
          break;
      }
      bus.emit('mcp:scene-update', state.scene);
      bus.emit('mcp:command', { command: 'timeline', args: { action, time } });

      return {
        content: [{ type: 'text', text: `Timeline: ${action}${time !== undefined ? ` at ${time}ms` : ''}` }],
      };
    }
  );

  server.tool(
    'set_scene',
    'Set scene-level properties (background, dimensions, duration).',
    {
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional().describe('Total animation duration in ms'),
      background: z.string().optional().describe('Background color or gradient'),
    },
    async (props) => {
      const clean = Object.fromEntries(Object.entries(props).filter(([_, v]) => v !== undefined));
      Object.assign(state.scene, clean);
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{ type: 'text', text: `Scene updated: ${Object.keys(clean).join(', ')}` }],
      };
    }
  );

  server.tool(
    'duplicate_element',
    'Duplicate an existing element with an optional position offset.',
    {
      id: z.string().describe('Element ID to duplicate'),
      offsetX: z.number().optional().describe('X offset from original (default: 20)'),
      offsetY: z.number().optional().describe('Y offset from original (default: 20)'),
    },
    async ({ id, offsetX, offsetY }) => {
      const el = state.scene.elements?.find(e => e.id === id);
      if (!el) {
        return { content: [{ type: 'text', text: `Element ${id} not found.` }] };
      }

      const newId = `el-${++elementCounter}`;
      const clone = {
        id: newId,
        type: el.type,
        props: {
          ...JSON.parse(JSON.stringify(el.props)),
          x: (el.props.x || 0) + (offsetX ?? 20),
          y: (el.props.y || 0) + (offsetY ?? 20),
        },
        keyframes: JSON.parse(JSON.stringify(el.keyframes || [])),
      };

      state.scene.elements.push(clone);
      bus.emit('mcp:scene-update', state.scene);

      return {
        content: [{ type: 'text', text: `Duplicated ${id} → ${newId}` }],
      };
    }
  );

  server.tool(
    'reorder_element',
    'Move an element up or down in the layer order (z-index).',
    {
      id: z.string().describe('Element ID'),
      direction: z.enum(['up', 'down', 'top', 'bottom']).describe('Direction to move'),
    },
    async ({ id, direction }) => {
      const elements = state.scene.elements || [];
      const idx = elements.findIndex(e => e.id === id);
      if (idx === -1) {
        return { content: [{ type: 'text', text: `Element ${id} not found.` }] };
      }

      const [el] = elements.splice(idx, 1);
      switch (direction) {
        case 'up': elements.splice(Math.min(idx + 1, elements.length), 0, el); break;
        case 'down': elements.splice(Math.max(idx - 1, 0), 0, el); break;
        case 'top': elements.push(el); break;
        case 'bottom': elements.unshift(el); break;
      }

      bus.emit('mcp:scene-update', state.scene);
      return {
        content: [{ type: 'text', text: `Element ${id} moved ${direction}.` }],
      };
    }
  );

  server.tool(
    'export_video',
    'Export the animation as an MP4 video using FFmpeg. Renders frames via the /render endpoint and stitches them together.',
    {
      output: z.string().optional().describe('Output file path (default: /tmp/visual-mcp-export.mp4)'),
      fps: z.number().optional().describe('Frames per second (default: 30)'),
      quality: z.enum(['draft', 'normal', 'high']).optional().describe('Quality preset (default: normal)'),
    },
    async ({ output, fps: fpsInput, quality }) => {
      const { execFile: exec } = await import('node:child_process');
      const { mkdir: mkDir } = await import('node:fs/promises');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(exec);

      const port = parseInt(process.env.VISUAL_MCP_PORT || '4200', 10);
      const duration = state.scene.duration || 5000;
      const fps = fpsInput || 30;
      const totalFrames = Math.ceil((duration / 1000) * fps);
      const outPath = output || '/tmp/visual-mcp-export.mp4';
      const framesDir = '/tmp/visual-mcp-frames';
      const w = state.scene.width || 1920;
      const h = state.scene.height || 1080;

      const screenshotTool = 'C:/Users/hmk/tools/screenshot/screenshot.mjs';

      try {
        await mkDir(framesDir, { recursive: true });

        // Render frames
        for (let i = 0; i < totalFrames; i++) {
          const t = Math.round((i / fps) * 1000);
          const framePath = `${framesDir}/frame-${String(i).padStart(5, '0')}.png`;
          const url = `http://localhost:${port}/render?t=${t}`;

          await execFileAsync('node', [screenshotTool, url, '--output', framePath, '--width', String(w), '--height', String(h)]);

          // Report progress every 10 frames
          if (i % 10 === 0) {
            bus.emit('mcp:command', { command: 'export-progress', args: { frame: i, total: totalFrames } });
          }
        }

        // Quality presets
        const crf = quality === 'high' ? '18' : quality === 'draft' ? '28' : '23';

        // Stitch with FFmpeg
        await execFileAsync('ffmpeg', [
          '-y', '-framerate', String(fps),
          '-i', `${framesDir}/frame-%05d.png`,
          '-c:v', 'libx264', '-crf', crf,
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          outPath,
        ], { timeout: 120000 });

        return {
          content: [{
            type: 'text',
            text: `Video exported: ${outPath}\nFrames: ${totalFrames}, FPS: ${fps}, Duration: ${(duration/1000).toFixed(1)}s`,
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Export failed: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'list_elements',
    'List all elements on the canvas with their properties.',
    {},
    async () => {
      const elements = state.scene.elements || [];
      if (elements.length === 0) {
        return { content: [{ type: 'text', text: 'Canvas is empty.' }] };
      }

      const summary = elements.map(el => {
        const kf = el.keyframes.length;
        return `- ${el.id} (${el.type}) at (${el.props.x}, ${el.props.y})${el.props.text ? ` "${el.props.text}"` : ''}${kf > 0 ? ` [${kf} keyframes]` : ''}`;
      }).join('\n');

      return {
        content: [{ type: 'text', text: summary }],
      };
    }
  );
}

export async function handleHttp(action, body, state) {
  switch (action) {
    case 'export':
      // Return the scene as exportable JSON
      return { scene: state.scene };
    default:
      return { error: `Unknown action: ${action}` };
  }
}
