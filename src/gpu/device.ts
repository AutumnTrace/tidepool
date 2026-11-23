export interface Gpu {
  adapter: GPUAdapter;
  device: GPUDevice;
  info: GPUAdapterInfo;
  timestamps: boolean;
}

export class WebGpuUnavailable extends Error {}

export async function initGpu(): Promise<Gpu> {
  if (!('gpu' in navigator) || !navigator.gpu) {
    throw new WebGpuUnavailable('This browser does not expose navigator.gpu.');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new WebGpuUnavailable('WebGPU is present but no GPU adapter was found.');
  }
  const timestamps = adapter.features.has('timestamp-query');
  const requiredFeatures: GPUFeatureName[] = timestamps ? ['timestamp-query'] : [];
  // Ask for the adapter's real buffer limits: a million particles needs more
  // than the 128 MiB default binding size in the scan's worst case.
  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: Math.min(10, adapter.limits.maxStorageBuffersPerShaderStage),
    },
  });
  return { adapter, device, info: adapter.info, timestamps };
}
