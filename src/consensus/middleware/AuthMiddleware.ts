import {PacketModel} from '../models/PacketModel';

export function AuthMiddleware() {
  return (target, propertyKey: string, descriptor: PropertyDescriptor) => {
    const originalValue = descriptor.value;
    descriptor.value = async (packet: PacketModel) => {
      console.log('was called!');
      return originalValue.call(ctx, packet);
    };
  };
}
