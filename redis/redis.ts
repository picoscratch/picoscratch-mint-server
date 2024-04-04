import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";
import { createClient } from "redis";
import { pubSub } from "./pubsub";
import { z } from "zod";
import { deleteDevice, disconnectClients, sendPacketToClients, sendPacketToDevice } from "../devices";

export const SERVERNAME = uniqueNamesGenerator({
	dictionaries: [
		adjectives, animals
	],
	separator: "-"
});
console.log("I am " + SERVERNAME);

export const redis = createClient({
	url: "redis://redis:6379"
});
await redis.connect();
await ensureKeys();
await ping();

export const { subscribe, publish } = await pubSub(redis);

async function ensureKeys() {
	if(!await redis.exists("newsletter")) {
		await redis.json.set("newsletter", "$", []);
	}
	if(!await redis.exists("clients")) {
		await redis.json.set("clients", "$", []);
	}
}

async function ping() {
	await redis.json.set("server:" + SERVERNAME, "$", { lastPing: Date.now() });
	await redis.expire("server:" + SERVERNAME, 70);
}

setInterval(() => {
	ping();
}, 60000)

const PubSubToDevicePacket = z.object({
	type: z.literal("toDevice"),
	serial: z.string(),
	packet: z.any()
});

const PubSubToClientPacket = z.object({
	type: z.literal("toClient"),
	serial: z.string(),
	packet: z.any()
});

const PubSubDisconnectClientsPacket = z.object({
	type: z.literal("disconnectClients"),
	serial: z.string()
});

const PubSubPacket = z.union([PubSubToDevicePacket, PubSubToClientPacket, PubSubDisconnectClientsPacket]);

subscribe(SERVERNAME, async (message, channel) => {
	console.log("[PUBSUB] " + message);
	
	const packet = PubSubPacket.parse(JSON.parse(message));
	if(PubSubToDevicePacket.safeParse(packet).success) {
		const { serial, packet: data } = PubSubToDevicePacket.parse(packet);
		sendPacketToDevice(serial, data);
	} else if(PubSubToClientPacket.safeParse(packet).success) {
		const { serial, packet: data } = PubSubToClientPacket.parse(packet);
		sendPacketToClients(serial, data);
	} else if(PubSubDisconnectClientsPacket.safeParse(packet).success) {
		const { serial } = PubSubDisconnectClientsPacket.parse(packet);
		disconnectClients(serial);
		deleteDevice(serial);
	}
});
