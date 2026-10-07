import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('config')
  getConfig() {
    return {
      googleClientId:
        process.env.GOOGLE_CLIENT_ID ||
        process.env.Google_Client_Id ||
        null,
      currency: 'PKR',
      fees: { clientPercent: 3, specialistPercent: 10 },
    };
  }
}
