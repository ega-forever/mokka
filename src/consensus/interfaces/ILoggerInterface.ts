export interface ILoggerInterface {

  info(text: string): void;
  trace(text: string): void;
  error(text: string): void;

}
