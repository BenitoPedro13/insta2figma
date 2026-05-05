import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  getHealth(): { status: string; service: string } {
    return { status: 'ok', service: 'insta2figma-api' };
  }
}
