// Taps a MediaStream into Float32 chunks on the main thread via a tiny AudioWorklet (mic capture and eval recording).
const CAPTURE_WORKLET_SOURCE = `class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) { const channel = inputs[0] && inputs[0][0]; if (channel) this.port.postMessage(channel.slice()); return true; }
}
registerProcessor("capture-processor", CaptureProcessor);`;

const workletReadyByContext = new WeakMap<BaseAudioContext, Promise<void>>();

export async function captureAudioChunks(
  audioContext: AudioContext,
  stream: MediaStream,
  onChunk: (chunk: Float32Array) => void,
): Promise<() => void> {
  if (!workletReadyByContext.has(audioContext)) {
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
    workletReadyByContext.set(audioContext, audioContext.audioWorklet.addModule(url));
  }
  await workletReadyByContext.get(audioContext);
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, "capture-processor");
  const sink = audioContext.createGain();
  sink.gain.value = 0; // keep the graph pulled without hearing ourselves
  workletNode.port.onmessage = (event) => onChunk(event.data as Float32Array);
  sourceNode.connect(workletNode).connect(sink).connect(audioContext.destination);
  return () => {
    workletNode.port.onmessage = null;
    sourceNode.disconnect();
    workletNode.disconnect();
    sink.disconnect();
  };
}
