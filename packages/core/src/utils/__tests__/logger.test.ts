describe('logger setup', () => {
  it('builds logger with console and file transports and printf formatters', () => {
    jest.resetModules();

    const combineMock = jest.fn((...args: unknown[]) => ({
      kind: 'combine',
      args,
    }));
    const timestampMock = jest.fn((opts?: unknown) => ({
      kind: 'timestamp',
      opts,
    }));
    const splatMock = jest.fn(() => ({ kind: 'splat' }));
    const colorizeMock = jest.fn((opts?: unknown) => ({
      kind: 'colorize',
      opts,
    }));
    const uncolorizeMock = jest.fn(() => ({ kind: 'uncolorize' }));

    const formattedMessages: string[] = [];
    const printfMock = jest.fn((formatter: (info: any) => string) => {
      const message = formatter({
        level: 'info',
        timestamp: '01 Jan 00:00:00',
        message: 'hello',
      });
      formattedMessages.push(message);
      return { kind: 'printf', message };
    });

    const createLoggerMock = jest.fn((config: unknown) => ({
      config,
      log: jest.fn(),
    }));

    const ConsoleMock = jest.fn(function Console(this: unknown, opts: unknown) {
      return { kind: 'console-transport', opts };
    });

    const FileMock = jest.fn(function File(this: unknown, opts: unknown) {
      return { kind: 'file-transport', opts };
    });

    jest.doMock('chalk', () => ({
      __esModule: true,
      default: {
        gray: (value: string) => `gray(${value})`,
      },
    }));

    jest.doMock('winston', () => ({
      createLogger: createLoggerMock,
      transports: {
        Console: ConsoleMock,
        File: FileMock,
      },
      format: {
        combine: combineMock,
        timestamp: timestampMock,
        splat: splatMock,
        colorize: colorizeMock,
        printf: printfMock,
        uncolorize: uncolorizeMock,
      },
    }));

    const { logger } = require('@utils/logger');

    expect(logger).toBeDefined();
    expect(createLoggerMock).toHaveBeenCalledTimes(1);
    expect(ConsoleMock).toHaveBeenCalledTimes(1);
    expect(FileMock).toHaveBeenCalledTimes(2);
    expect(printfMock).toHaveBeenCalledTimes(3);
    expect(formattedMessages[0]).toContain('gray(01 Jan 00:00:00)');
    expect(formattedMessages[1]).toContain('01 Jan 00:00:00');
    expect(formattedMessages[2]).toContain('01 Jan 00:00:00');
  });
});
