import type { RedisClientType, RedisModules, RedisFunctions, RedisScripts } from "redis";
import z from "zod";

export async function pubSub(redis: RedisClientType<RedisModules, RedisFunctions, RedisScripts>) {
	const sub = redis.duplicate();
	await sub.connect();
	const pub = redis.duplicate();
	await pub.connect();
	// return { sub, pub };
	return {
		subscribe(channel: string, callback: (message: string, channel: string) => void) {
			sub.subscribe(channel, callback);
		},
		publish(channel: string, message: string) {
			pub.publish(channel, message);
		}
	};
}

export const PubSubToClientPacket = z.object({
	type: z.literal("toClient"),
	serial: z.string(),
	data: z.any()
});

export const PubSubToDevicePacket = z.object({
	type: z.literal("toDevice"),
	serial: z.string(),
	data: z.any()
});

export const PubSubDisconnectClientsPacket = z.object({
	type: z.literal("disconnectClients"),
	serial: z.string()
});

export const PubSubPacket = z.union([PubSubToClientPacket, PubSubToDevicePacket, PubSubDisconnectClientsPacket]);