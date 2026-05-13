import axios from 'axios';
import { fetchPairs } from './fetchPairs';

jest.mock('axios');

const mockAxios = axios as jest.Mocked<typeof axios>;

describe('fetchPairs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch and extract pool data correctly', async () => {
    const now = Date.now();
    const mockResponse = {
      data: {
        data: [
          {
            address: '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6',
            name: 'SOL-USDC',
            tvl: 4029438.1192549462,
            volume: { '24h': 32896777.47171245 },
            fees: { '24h': 13252.31813313971 },
            pool_config: { bin_step: 4 },
            created_at: now - 86400000,
          },
          {
            address: '3C5YE97HADPDxZehYq9Cis8AXr9aNyrUsczKzE1nDbW9',
            name: 'TRUMP-USDC',
            tvl: '9033902.725410815',
            volume: { '24h': '31047015.168765645' },
            fees: { '24h': '33122.45180545833' },
            pool_config: { bin_step: '10' },
            created_at: '1737183210000',
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    const result = await fetchPairs();

    expect(result).toHaveLength(2);
    expect(result[0].address).toBe('5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6');
    expect(result[0].pair).toBe('SOL-USDC');
    expect(result[0].tvl).toBe(4029438.1192549462);
    expect(result[0].fees24h).toBe(13252.31813313971);
    expect(result[0].volume24h).toBe(32896777.47171245);
    expect(result[0].binStep).toBe(4);
    expect(result[0].poolAge).toBeCloseTo(86400, 0);

    expect(result[1].address).toBe('3C5YE97HADPDxZehYq9Cis8AXr9aNyrUsczKzE1nDbW9');
    expect(result[1].pair).toBe('TRUMP-USDC');
    expect(result[1].binStep).toBe(10);
  });

  it('should throw on missing data array', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: {} });

    await expect(fetchPairs()).rejects.toThrow('Invalid API response');
  });

  it('should throw on missing required string field', async () => {
    const mockResponse = {
      data: {
        data: [
          {
            // missing address field
            name: 'SOL-USDC',
            tvl: 1000,
            volume: { '24h': 5000 },
            fees: { '24h': 500 },
            pool_config: { bin_step: 25 },
            created_at: Date.now(),
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    await expect(fetchPairs()).rejects.toThrow('Field address must be a string');
  });

  it('should throw on empty string field', async () => {
    const mockResponse = {
      data: {
        data: [
          {
            address: '',
            name: 'SOL-USDC',
            tvl: 1000,
            volume: { '24h': 5000 },
            fees: { '24h': 500 },
            pool_config: { bin_step: 25 },
            created_at: Date.now(),
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    await expect(fetchPairs()).rejects.toThrow('Field address cannot be empty');
  });

  it('should throw on invalid number field', async () => {
    const mockResponse = {
      data: {
        data: [
          {
            address: '0x1234',
            name: 'SOL-USDC',
            tvl: 'invalid',
            volume: { '24h': 5000 },
            fees: { '24h': 500 },
            pool_config: { bin_step: 25 },
            created_at: Date.now(),
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    await expect(fetchPairs()).rejects.toThrow('Field tvl must be a valid number');
  });

  it('should throw on negative number field', async () => {
    const mockResponse = {
      data: {
        data: [
          {
            address: '0x1234',
            name: 'SOL-USDC',
            tvl: -1000,
            volume: { '24h': 5000 },
            fees: { '24h': 500 },
            pool_config: { bin_step: 25 },
            created_at: Date.now(),
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    await expect(fetchPairs()).rejects.toThrow('Field tvl must be non-negative');
  });

  it('should coerce string numbers to numbers', async () => {
    const now = Date.now();
    const mockResponse = {
      data: {
        data: [
          {
            address: '0x1234',
            name: 'SOL-USDC',
            tvl: '1000.5',
            volume: { '24h': '5000' },
            fees: { '24h': '250' },
            pool_config: { bin_step: '25' },
            created_at: now,
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    const result = await fetchPairs();

    expect(result[0].tvl).toBe(1000.5);
    expect(result[0].fees24h).toBe(250);
    expect(result[0].volume24h).toBe(5000);
    expect(result[0].binStep).toBe(25);
  });

  it('should call correct API endpoint with limit', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { data: [] } });

    await fetchPairs(50);

    expect(mockAxios.get).toHaveBeenCalledWith('https://dlmm.datapi.meteora.ag/pools', {
      params: { limit: 50 },
    });
  });

  it('should calculate pool age in seconds', async () => {
    const now = Date.now();
    const oneDayAgo = now - 86400000;
    const mockResponse = {
      data: {
        data: [
          {
            address: 'addr1',
            name: 'SOL-USDC',
            tvl: 1000,
            volume: { '24h': 5000 },
            fees: { '24h': 500 },
            pool_config: { bin_step: 25 },
            created_at: oneDayAgo,
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    const result = await fetchPairs();

    expect(result[0].poolAge).toBeGreaterThan(86300);
    expect(result[0].poolAge).toBeLessThan(86500);
  });
});
