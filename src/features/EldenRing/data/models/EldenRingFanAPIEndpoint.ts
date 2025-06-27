interface EldenRingFanAPIEndpoint {
  endpoint: string;
  method: string;
  keysAndIds: Record<string, any>[];
  params: Record<string, any>[];
}

export default EldenRingFanAPIEndpoint;
