import { createClient as createRedisClient } from "redis";
const redis = createRedisClient({
	url: "redis://redis:6379"
});
await redis.connect();
// await redis.subscribe("sensor", (msg) => {
// 	console.log(msg);
// })
// await redis.publish("sensor", JSON.stringify({ temperature: 25, humidity: 50 }));

import type { ServerWebSocket, Socket } from "bun";
import { z } from "zod";

const sockets: {[serial: string]: { socket: Socket, lastPacket: Date }} = {};
const websockets: { socket: ServerWebSocket<unknown>, serials: string[] }[] = [];

Bun.listen({
	hostname: "0.0.0.0",
	port: 2737,
	socket: {
		data(socket, data) {
			try {
				const packet = JSON.parse(data.toString());

				const mySocket = Object.keys(sockets).find(serial => sockets[serial].socket === socket);
				if(mySocket) {
					sockets[mySocket].lastPacket = new Date();
					console.log("[SOCKET] [" + mySocket + "] " + JSON.stringify(packet));
				} else {
					console.log("[SOCKET] " + JSON.stringify(packet));
				}
				
				// if("serial" in packet) {
				// 	if(!(packet.serial in sockets)) {
				// 		sockets[packet] = { socket };
				// 	}
				// }
				if(SensorPacket.safeParse(packet).success) {
					const sensorpacket = SensorPacket.parse(packet);

					if(!(sensorpacket.serial in sockets)) {
						console.log("[OPENING] Opening " + sensorpacket.serial);
						sockets[sensorpacket.serial] = { socket, lastPacket: new Date() };
					}
				}
				
				// Broadcast to all clients with the same serial
				if(!mySocket) {
					socket.write(JSON.stringify({ error: 1, message: "You dont have a serial yet" }));
					return;
				}
				for(const websocket of websockets.filter(websocket => websocket.serials.includes(mySocket))) {
					websocket.socket.send(data.toString());
				}
			} catch (error) {
				socket.write(JSON.stringify({ error: "Invalid JSON" }));
			}
		}, // Msg from client
		open(socket) {}, // Client connected
		close(socket) {
			// Remove socket from sockets
			for(const serial in sockets) {
				if(sockets[serial].socket === socket) {
					console.log("[CLOSING] Closing " + serial);
					for(const websocket of websockets.filter(websocket => websocket.serials.includes(serial))) {
						websocket.socket.close();
					}
					delete sockets[serial];
				}
			}
		}, // Client disconnected
		drain(socket) {}, // Socket ready for more data, which means the data sent to client is sent successfully
		error(socket, error) {
			// Remove socket from sockets
			for(const serial in sockets) {
				if(sockets[serial].socket === socket) {
					console.log("[CLOSING] Socket error for " + serial);
					for(const websocket of websockets.filter(websocket => websocket.serials.includes(serial))) {
						websocket.socket.close();
					}
					delete sockets[serial];
				}
			}
		} // Socket error
	}
})

setInterval(() => {
	const now = new Date();
	for(const serial in sockets) {
		// Remove socket if last packet was more than 10 seconds ago
		if(now.getTime() - sockets[serial].lastPacket.getTime() > 10000) {
			// Disconnect all websockets with this serial
			console.log("[CLOSING] Serial " + serial + " timed out");
			for(const websocket of websockets.filter(websocket => websocket.serials.includes(serial))) {
				websocket.socket.close();
			}
			sockets[serial].socket.end();
			delete sockets[serial];
		}
	}
});

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
			websockets.push({ socket: ws, serials: [] });
		}, // a socket is opened
		message(ws, message) {
			try {
				console.log(message.toString());
				
				const packet = JSON.parse(message.toString());

				console.log("[WEBSOCKET] " + JSON.stringify(packet));
				
				if(WSSerialPacket.safeParse(packet).success) {
					const serialpacket = WSSerialPacket.parse(packet);

					if(!(serialpacket.serial in sockets)) {
						ws.send(JSON.stringify({ type: "error", error: 1, message: "Serial not found" }));
						return;
					}

					// Add serial to websocket
					const websocket = websockets.find(websocket => websocket.socket === ws);
					if(websocket) {
						websocket.serials.push(serialpacket.serial);
					}
				} else {
					// Broadcast to all clients in the serials array
					const websocket = websockets.find(websocket => websocket.socket === ws);
					if(websocket) {
						for(const serial of websocket.serials) {
							if(serial in sockets) {
								sockets[serial].socket.write(message.toString());
							}
						}
					}
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