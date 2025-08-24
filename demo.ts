import { clients } from "./devices";

const ALL_SENSORS = ["temp", "co2", "tds", "ph"];
const RANGES: Record<Sensor, [number, number]> = {
	temp: [15, 30],
	co2: [300, 800],
	tds: [0, 1000],
	ph: [5, 8]
}
type Sensor = typeof ALL_SENSORS[number];

setInterval(() => {
	for(const user of clients.filter(c => c.serials.includes("demo"))) {
		const sensors: Record<Sensor, number> = {};
		for(const sensor of ALL_SENSORS) {
			const [min, max] = RANGES[sensor];
			sensors[sensor] = Math.round((Math.random() * (max - min) + min) * 100) / 100;
		}
		user.socket.send(JSON.stringify({ type: "sensor", serial: "demo", ...sensors }));
	}
}, 1000);