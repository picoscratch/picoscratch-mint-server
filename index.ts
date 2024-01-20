// import { createClient as createRedisClient } from "redis";
// const redis = createRedisClient({
// 	url: "redis://localhost:6379"
// });
// await redis.connect();
// await redis.subscribe("sensor", (msg) => {
// 	console.log(msg);
// })
// await redis.publish("sensor", JSON.stringify({ temperature: 25, humidity: 50 }));

import type { ServerWebSocket, Socket } from "bun";
import { z } from "zod";

const sockets: {[serial: string]: { socket: Socket }} = {};
const websockets: { socket: ServerWebSocket<unknown>, serials: string[] }[] = [];

Bun.listen({
	hostname: "0.0.0.0",
	port: 2737,
	socket: {
		data(socket, data) {
			try {
				console.log(data.toString())
				const packet = JSON.parse(data.toString());
				
				// if("serial" in packet) {
				// 	if(!(packet.serial in sockets)) {
				// 		sockets[packet] = { socket };
				// 	}
				// }
				if(SensorPacket.safeParse(packet).success) {
					const sensorpacket = SensorPacket.parse(packet);

					if(!(sensorpacket.serial in sockets)) {
						sockets[sensorpacket.serial] = { socket };
					}
				}
				
				// Broadcast to all clients with the same serial
				const mySerial = Object.keys(sockets).find(serial => sockets[serial].socket === socket);
				if(!mySerial) {
					socket.write(JSON.stringify({ error: 1, message: "Serial not found" }));
					return;
				}
				for(const websocket of websockets.filter(websocket => websocket.serials.includes(mySerial))) {
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
					delete sockets[serial];
				}
			}
		}, // Client disconnected
		drain(socket) {}, // Socket ready for more data, which means the data sent to client is sent successfully
		error(socket, error) {} // Socket error
	}
})

Bun.serve({
	port: 8080,
  fetch(req, server) {
    // upgrade the request to a WebSocket
    if (server.upgrade(req)) {
      return; // do not return a Response
    }
    return new Response("Upgrade failed :(", { status: 500 });
  },
  websocket: {
		open(ws) {
			websockets.push({ socket: ws, serials: [] });
		}, // a socket is opened
		message(ws, message) {
			try {
				console.log(message.toString());
				
				const packet = JSON.parse(message.toString());
				
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