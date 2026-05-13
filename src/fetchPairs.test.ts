import axios from 'axios';
import { fetchPairs } from './fetchPairs';
import { PoolData } from './types';

jest.mock('axios');

const mockAxios = axios as jest.Mocked<typeof axios>;

describe('fetchPairs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch and extract pool data correctly', async () => {
    const mockResponse = {
      data: {
        pairs: [
          {
            address: '0x1234567890123456789012345678901234567890',
            pair: 'SOL/USDC',
            tvl: 1000000.5,
            fees24h: 5000.25,
            volume24h: 50000000,
            binStep: 25,
            poolAge: 86400,
          },
          {
            address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            pair: 'RAY/USDC',
            tvl: '500000',
            fees24h: '2500',
            volume24h: '25000000',
            binStep: '50',
            poolAge: '172800',
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    const result = await fetchPairs();

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      address: '0x1234567890123456789012345678901234567890',
      pair: 'SOL/USDC',
      tvl: 1000000.5,
      fees24h: 5000.25,
      volume24h: 50000000,
      binStep: 25,
      poolAge: 86400,
    });
    expect(result[1]).toEqual({
      address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      pair: 'RAY/USDC',
      tvl: 500000,
      fees24h: 2500,
      volume24h: 25000000,
      binStep: 50,
      poolAge: 172800,
    });
  });

  it('should throw on missing pairs array', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: {} });

    await expect(fetchPairs()).rejects.toThrow('Invalid API response');
  });

  it('should throw on missing required string field', async () => {
    const mockResponse = {
      data: {
        pairs: [
          {
            address: '0x1234',
            // missing pair field
            tvl: 1000,
            fees24h: 500,
            volume24h: 5000,
            binStep: 25,
            poolAge: 86400,
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    await expect(fetchPairs()).rejects.toThrow('Field pair must be a string');
  });

  it('should throw on empty string field', async () => {
    const mockResponse = {
      data: {
        pairs: [
          {
            address: '',
            pair: 'SOL/USDC',
            tvl: 1000,
            fees24h: 500,
            volume24h: 5000,
            binStep: 25,
            poolAge: 86400,
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
        pairs: [
          {
            address: '0x1234',
            pair: 'SOL/USDC',
            tvl: 'invalid',
            fees24h: 500,
            volume24h: 5000,
            binStep: 25,
            poolAge: 86400,
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
        pairs: [
          {
            address: '0x1234',
            pair: 'SOL/USDC',
            tvl: -1000,
            fees24h: 500,
            volume24h: 5000,
            binStep: 25,
            poolAge: 86400,
          },
        ],
      },
    };

    mockAxios.get.mockResolvedValueOnce(mockResponse);

    await expect(fetchPairs()).rejects.toThrow('Field tvl must be non-negative');
  });

  it('should coerce string numbers to numbers', async () => {
    const mockResponse = {
      data: {
        pairs: [
          {
            address: '0x1234',
            pair: 'SOL/USDC',
            tvl: '1000.5',
            fees24h: '250',
            volume24h: '5000',
            binStep: '25',
            poolAge: '86400',
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
    expect(result[0].poolAge).toBe(86400);
  });

  it('should call correct API endpoint', async () => {
    mockAxios.get.mockResolvedValueOnce({ data: { pairs: [] } });

    await fetchPairs();

    expect(mockAxios.get).toHaveBeenCalledWith('https://dlmm-api.meteora.ag/pair/all');
  });
});
