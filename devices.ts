import type { ServerWebSocket, Socket } from "bun";
import { SERVERNAME, redis } from "./redis/redis";
import { z } from "zod";
import { randomUUID } from "crypto";

type Device = {
	socket: Socket,
	lastPacket: Date
}

type Client = {
	socket: ServerWebSocket<unknown>,
	serials: string[],
	uuid: string
}

const RedisSocket = z.object({
	server: z.string()
})

const RedisClients = z.array(z.object({
	serials: z.array(z.string()),
	server: z.string(),
	uuid: z.string()
}))

const devices: {[serial: string]: Device} = {};
const clients: Client[]                   = [];

export async function connectDevice(serial: string, socket: Socket) {
	devices[serial] = { socket, lastPacket: new Date() };
	await redis.json.set("socket:" + serial, "$", { server: SERVERNAME });
}

export async function isDeviceConnected(serial: string) {
	return serial in devices || await redis.exists("socket:" + serial);
}

export async function sendPacketToDevice(serial: string, packet: any) {
	if(serial in devices) {
		devices[serial].socket.write(JSON.stringify(packet));
		return;
	} else if(await redis.exists("socket:" + serial)) {
		const rSock = await redis.json.get("socket:" + serial);
		if(!RedisSocket.safeParse(rSock).success) {
			throw new Error("Invalid socket");
		}
		const sock = RedisSocket.parse(rSock);
		await redis.publish(sock.server, JSON.stringify({ type: "toDevice", serial, packet }));
		return;
	}

	throw new Error("Device not found");
}

export async function sendPacketToClients(serial: string, packet: any) {
	for(const client of clients.filter(client => client.serials.includes(serial))) {
		client.socket.send(JSON.stringify(packet));
	}

	{
		const rClients = await redis.json.get("clients");
		if(!RedisClients.safeParse(rClients).success) {
			return;
		}
		const clients = RedisClients.parse(rClients);
		for(const socket of clients.filter(socket => socket.serials.includes(serial))) {
			if(socket.server === SERVERNAME) continue;
			await redis.publish(socket.server, JSON.stringify({ type: "toClient", serial, packet }));
		}
	}
}

export async function getRegisteredDevice(serial: string) {
	const device = await redis.json.get("device:" + serial);
	return device;
}

export async function disconnectClients(serial: string) {
	for(const client of clients.filter(client => client.serials.includes(serial))) {
		client.socket.close();
	}

	if(await redis.exists("clients")) {
		const rClients = await redis.json.get("clients");
		if(!RedisClients.safeParse(rClients).success) {
			return;
		}
		const clients = RedisClients.parse(rClients);
		for(const socket of clients.filter(socket => socket.serials.includes(serial))) {
			if(socket.server === SERVERNAME) continue;
			await redis.publish(socket.server, JSON.stringify({ type: "disconnectClients", serial }));
		}
		await redis.json.set("clients", "$", clients.filter(socket => !socket.serials.includes(serial)));
	}
}

export async function deleteDevice(serial: string) {
	delete devices[serial];
	await redis.json.del("socket:" + serial);
}

export async function resetLastPacket(serial: string) {
	if(serial in devices) {
		devices[serial].lastPacket = new Date();
	}
}

export async function getSerialFromSocket(socket: Socket) {
	return Object.keys(devices).find(serial => devices[serial].socket === socket);
}

export async function registerClient(socket: ServerWebSocket<unknown>) {
	const uuid = randomUUID();
	clients.push({ socket, serials: [], uuid });
	await redis.json.arrAppend("clients", "$", { serials: [], server: SERVERNAME, uuid });
}

export async function addSerialToClient(socket: ServerWebSocket<unknown>, serial: string) {
	const client = clients.find(client => client.socket === socket);
	if(!client) throw new Error("Client not found");
	if(!await isDeviceConnected(serial)) throw new Error("Device not connected");
	client.serials.push(serial);
	const uuid = client.uuid;
	const rClients = await redis.json.get("clients");
	if(!RedisClients.safeParse(rClients).success) {
		throw new Error("Invalid clients");
	}
	const dbClients = RedisClients.parse(rClients);
	const dbClient = dbClients.find(client => client.uuid === uuid);
	if(!dbClient) throw new Error("Client not found");
	dbClient.serials.push(serial);
	await redis.json.set("clients", "$", dbClients);
}

export async function getSerialsFromClient(socket: ServerWebSocket<unknown>) {
	const client = clients.find(client => client.socket === socket);
	if(!client) throw new Error("Client not found");
	return client.serials;
}

setInterval(() => {
	const now = new Date();
	for(const serial in devices) {
		// Remove socket if last packet was more than 10 seconds ago
		if(now.getTime() - devices[serial].lastPacket.getTime() > 10000) {
			console.log("[CLOSING] Serial " + serial + " timed out");
			devices[serial].socket.end();
			// await disconnectClients(serial);
			// await deleteDevice(serial);
		}
	}
});

process.on("beforeexit", async () => {
	await redis.del("server:" + SERVERNAME);

	for(const socket of Object.keys(devices)) {
		await redis.json.del("socket:" + socket);
	}
	let rClients = await redis.json.get("clients");
	if(!RedisClients.safeParse(rClients).success) {
		return;
	}
	const clients = RedisClients.parse(rClients);
	await redis.json.set("clients", "$", clients.filter((client) => client.server !== SERVERNAME));
});
