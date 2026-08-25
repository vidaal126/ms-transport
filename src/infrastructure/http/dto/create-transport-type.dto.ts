import { IsString, IsNotEmpty, IsInt, Min } from "class-validator";

export class CreateTransportTypeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  dailyCapacity!: number;
}
