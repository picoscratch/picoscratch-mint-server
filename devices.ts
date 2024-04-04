import type { ServerWebSocket, Socket } from "bun";
import { redis } from ".";

type Device = {
	socket: Socket,
	lastPacket: Date
}

type Client = {
	socket: ServerWebSocket<unknown>,
	serials: string[]
}

const devices: {[serial: string]: Device} = {};
const clients: Client[]                   = [];

export async function connectDevice(serial: string, socket: Socket) {
	devices[serial] = { socket, lastPacket: new Date() };
}

export async function isDeviceConnected(serial: string) {
	return serial in devices;
}

export async function sendPacketToDevice(serial: string, packet: any) {
	if(serial in devices) {
		devices[serial].socket.write(JSON.stringify(packet));
		return;
	}

	throw new Error("Device not found");
}

export async function sendPacketToClients(serial: string, packet: any) {
	for(const client of clients.filter(client => client.serials.includes(serial))) {
		client.socket.send(JSON.stringify(packet));
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
}

export async function deleteDevice(serial: string) {
	delete devices[serial];
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
	clients.push({ socket, serials: [] });
}

export async function addSerialToClient(socket: ServerWebSocket<unknown>, serial: string) {
	const client = clients.find(client => client.socket === socket);
	if(!client) throw new Error("Client not found");
	if(!await isDeviceConnected(serial)) throw new Error("Device not connected");
	client.serials.push(serial);
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
