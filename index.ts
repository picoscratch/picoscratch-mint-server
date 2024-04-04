import { createClient as createRedisClient } from "redis";
import { z } from "zod";
import { addSerialToClient, connectDevice, deleteDevice, disconnectClients, getRegisteredDevice, getSerialFromSocket, getSerialsFromClient, isDeviceConnected, registerClient, resetLastPacket, sendPacketToClients, sendPacketToDevice } from "./devices";

export const redis = createRedisClient({
	url: "redis://redis:6379"
});
await redis.connect();

Bun.listen({
	hostname: "0.0.0.0",
	port: 2737,
	socket: {
		async data(socket, data) {
			try {
				const packet = JSON.parse(data.toString());

				// const mySocket = Object.keys(sockets).find(serial => sockets[serial].socket === socket);
				let mySerial = await getSerialFromSocket(socket);
				if(mySerial) {
					await resetLastPacket(mySerial);
					console.log("[SOCKET] [" + mySerial + "] " + JSON.stringify(packet));
				} else {
					console.log("[SOCKET] " + JSON.stringify(packet));
				}

				if(SensorPacket.safeParse(packet).success) {
					const sensorpacket = SensorPacket.parse(packet);

					if(!(await isDeviceConnected(sensorpacket.serial))) {
						if(await getRegisteredDevice(sensorpacket.serial) === null) {
							socket.write(JSON.stringify({ error: 1, message: "Device not registered" }));
							socket.end();
							return;
						}
						console.log("[OPENING] Opening " + sensorpacket.serial);
						await connectDevice(sensorpacket.serial, socket);
						mySerial = sensorpacket.serial;
					}
				}
				
				// Broadcast to all clients with the same serial
				if(!mySerial) {
					socket.write(JSON.stringify({ error: 1, message: "You dont have a serial yet" }));
					return;
				}
				await sendPacketToClients(mySerial, packet);
			} catch (error) {
				socket.write(JSON.stringify({ error: "Invalid JSON" }));
			}
		}, // Msg from client
		async close(socket) {
			// Remove socket from sockets
			const serial = await getSerialFromSocket(socket);
			if(serial) {
				console.log("[CLOSING] Closing " + serial);
				await disconnectClients(serial);
				await deleteDevice(serial);
			}
		}, // Client disconnected
		error(socket, error) {
			socket.end();
		} // Socket error
	}
})

Bun.serve({
	port: 8080,
  async fetch(req, server) {
		const url = new URL(req.url);
		if(url.pathname === "/") {
			// upgrade the request to a WebSocket
			if(server.upgrade(req)) {
				return; // do not return a Response
			}
			return new Response("<meta http-equiv=\"refresh\" content=\"0; url=https://mint.picoscratch.de\">", { status: 500 });
		} else if(url.pathname === "/api/subNewsletter") {
			const body = await req.json();
			if(!("email" in body)) {
				return new Response("Bad Request", { status: 400 });
			}
			const EMAIL_REGEX = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
			if(!EMAIL_REGEX.test(body.email)) {
				return new Response("Bad Request", { status: 400 });
			}
			await redis.json.arrAppend("newsletter", "$", body.email);
			return new Response("OK", { status: 200 });
		} else {
			return new Response("Not Found", { status: 404 });
		}
  },
  websocket: {
		open(ws) {
			registerClient(ws);
		}, // a socket is opened
		async message(ws, message) {
			try {
				const packet = JSON.parse(message.toString());

				console.log("[WEBSOCKET] " + JSON.stringify(packet));
				
				if(WSSerialPacket.safeParse(packet).success) {
					const serialpacket = WSSerialPacket.parse(packet);

					await addSerialToClient(ws, serialpacket.serial);

					return;
				}
				// Broadcast to all clients in the serials array
				const serials = await getSerialsFromClient(ws);
				for(const serial of serials) {
					await sendPacketToDevice(serial, packet);
				}
			} catch (error) {
				console.error(error);
				ws.send(JSON.stringify({ error: "Invalid JSON" }));
			}
		}, // a message is received
		close(ws, code, message) {}, // a socket is closed
	}, // handlers
});

const SensorPacket = z.object({
	serial: z.string()
})

const WSSerialPacket = z.object({
	type: z.literal("serial"),
	serial: z.string()
})