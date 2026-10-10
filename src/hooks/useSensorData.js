import { useEffect, useRef, useState } from 'react';
import { getMockSensorData } from '../utils/mockSensors';

export const useSensorData = () => {
  const [data, setData] = useState(getMockSensorData());
  const [history, setHistory] = useState([]);
  const buffer = useRef([]);

  useEffect(() => {
    const tick = setInterval(() => {
      const now = new Date();
      const seconds = now.getSeconds();

      buffer.current.push(getMockSensorData());

      if (seconds % 10 === 0 && buffer.current.length > 0) {
        const samples = buffer.current;
        buffer.current = [];

        const averaged = {
          reservoir: {
            ph: avg(samples, s => parseFloat(s.reservoir.ph)).toFixed(2),
            tds: Math.round(avg(samples, s => parseFloat(s.reservoir.tds))),
          },
          environment: {
            temperature: avg(samples, s => parseFloat(s.environment.temperature)).toFixed(1),
            humidity: avg(samples, s => parseFloat(s.environment.humidity)).toFixed(1),
          },
          deviceStatus: samples[samples.length - 1].deviceStatus,
          mistingActive: samples[samples.length - 1].mistingActive,
          mistingInterval: samples[samples.length - 1].mistingInterval,
          nextMisting: samples[samples.length - 1].nextMisting,
          lastUpdated: now.toISOString(),
          timestamp: now,
        };

        setData(averaged);
        setHistory(prev => [...prev.slice(-59), averaged]);
      }
    }, 1000);

    return () => clearInterval(tick);
  }, []);

  return { data, history };
};

function avg(arr, fn) {
  return arr.reduce((sum, item) => sum + fn(item), 0) / arr.length;
}