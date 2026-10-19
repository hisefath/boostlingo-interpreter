// Taps a MediaStream into Float32 chunks on the main thread via a tiny AudioWorklet (mic capture and eval recording).
const WORKLET = `class Cap extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice()); return true; }
}
registerProcessor("cap", Cap);`;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

export async function capture(
  ctx: AudioContext,
  stream: MediaStream,
  onChunk: (f: Float32Array) => void,
): Promise<() => void> {
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    loaded.set(ctx, ctx.audioWorklet.addModule(url));
  }
  await loaded.get(ctx);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "cap");
  const sink = ctx.createGain();
  sink.gain.value = 0; // keep the graph pulled without hearing ourselves
  node.port.onmessage = (e) => onChunk(e.data as Float32Array);
  src.connect(node).connect(sink).connect(ctx.destination);
  return () => {
    node.port.onmessage = null;
    src.disconnect();
    node.disconnect();
    sink.disconnect();
  };
}
