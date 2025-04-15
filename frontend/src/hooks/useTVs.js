import { useState, useEffect } from 'react';

// Use relative URLs to leverage the proxy configuration
const fetchApi = async (url, options = {}) => {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error in fetchApi:', error);
    throw error;
  }
};

const useTVs = () => {
  const [tvs, setTvs] = useState([]);

  useEffect(() => {
    fetchApi('/api/tvs')
      .then((data) => setTvs(data))
      .catch((error) => console.error('Error fetching TVs:', error));
  }, []);

  const addTV = ({ ip, name, icon }) => {
    fetchApi('/api/tvs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ip, name, icon }),
    })
      .then((newTV) => setTvs((prevTvs) => [...prevTvs, newTV]))
      .catch((error) => console.error('Error adding TV:', error));
  };

  const pairTV = (ip) => {
    return fetchApi(`/api/tvs/${ip}/pair`, {
      method: 'POST',
    });
  };

  const finishPairing = (ip, pairingCode) => {
    return fetchApi(`/api/tvs/${ip}/pair`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pairing_code: pairingCode }),
    });
  };

  const controlTV = (ip, command) => {
    return fetchApi(`/api/tvs/${ip}/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    });
  };

  const listAvailableDevices = () => {
    return fetchApi('/api/devices');
  };

  const discoverAvailableTVs = () => {
    return fetchApi('/api/available_tvs')
      .then((data) => {
        console.log('Fetched available TVs:', data);
        return data;
      })
      .catch((error) => console.error('Error discovering available TVs:', error));
  };

  return { tvs, addTV, pairTV, finishPairing, controlTV, listAvailableDevices, discoverAvailableTVs };
};

export default useTVs;